import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id, sku_code } = await req.json();

    if (!workspace_id || !sku_code) {
      return Response.json({ 
        ok: false, 
        error: 'workspace_id and sku_code required' 
      }, { status: 400 });
    }

    console.log(`[Reconcile SKU] Starting reconciliation for ${sku_code} in workspace ${workspace_id}`);

    // Fetch all data for this SKU
    const allSkus = await base44.asServiceRole.entities.SKU.filter({ tenant_id: workspace_id });
    const sku = allSkus.find(s => s.sku_code === sku_code);
    
    if (!sku) {
      console.log(`[Reconcile SKU] SKU not found: ${sku_code}`);
      return Response.json({ ok: false, error: 'SKU not found' }, { status: 404 });
    }
    
    console.log(`[Reconcile SKU] Found SKU: ${sku.sku_code} (ID: ${sku.id})`);

    const [currentStock, movements, tenantData] = await Promise.all([
      base44.asServiceRole.entities.CurrentStock.filter({ tenant_id: workspace_id, sku_id: sku.id }),
      base44.asServiceRole.entities.StockMovement.filter({ tenant_id: workspace_id, sku_id: sku.id, is_archived: false }),
      base44.asServiceRole.entities.Tenant.filter({ id: workspace_id })
    ]);

    const stock = currentStock[0];
    const before_stock = stock?.quantity_available || 0;
    let created_movements = 0;
    
    console.log(`[Reconcile SKU] Current stock record:`, stock);
    console.log(`[Reconcile SKU] Before stock: ${before_stock}`);
    console.log(`[Reconcile SKU] Existing movements: ${movements.length}`);

    // Step 1: Check for and create missing OUT movements for fulfilled orders
    console.log(`[Reconcile SKU] Step 1: Checking for missing OUT movements`);
    
    const tenant = tenantData[0];
    const lastResetAt = tenant?.last_stock_reset_at ? new Date(tenant.last_stock_reset_at) : null;
    
    // Get all orders for this SKU that are fulfilled
    const allOrders = await base44.asServiceRole.entities.Order.filter({ 
      tenant_id: workspace_id,
      status: 'fulfilled'
    });
    
    const fulfilledOrders = lastResetAt 
      ? allOrders.filter(o => {
          const orderDate = new Date(o.order_date || o.created_date);
          return orderDate > lastResetAt;
        })
      : allOrders;

    // Get order lines for this SKU
    const orderLines = await base44.asServiceRole.entities.OrderLine.filter({
      tenant_id: workspace_id,
      sku_id: sku.id
    });

    // Check each fulfilled order line for missing movement
    for (const line of orderLines) {
      if (line.is_returned) continue;
      
      const order = fulfilledOrders.find(o => o.id === line.order_id);
      if (!order) continue;
      
      const hasMovement = movements.some(m => 
        m.reference_type === 'order_line' && 
        m.reference_id === line.id &&
        m.movement_type === 'order_fulfillment'
      );

      if (!hasMovement) {
        console.log(`[Reconcile SKU] Creating missing OUT movement for order ${order.amazon_order_id}, line ${line.id}`);
        
        await base44.asServiceRole.entities.StockMovement.create({
          tenant_id: workspace_id,
          sku_id: sku.id,
          sku_code: sku.sku_code,
          movement_type: 'order_fulfillment',
          quantity: -line.quantity,
          reference_type: 'order_line',
          reference_id: line.id,
          movement_date: order.order_date || new Date().toISOString().split('T')[0],
          notes: `Retroactive OUT for order ${order.amazon_order_id}`,
          is_archived: false
        });
        
        created_movements++;
      }
    }

    // Step 2: Re-fetch movements and calculate expected stock
    console.log(`[Reconcile SKU] Step 2: Recalculating stock after creating ${created_movements} missing movements`);
    
    const updatedMovements = await base44.asServiceRole.entities.StockMovement.filter({ 
      tenant_id: workspace_id, 
      sku_id: sku.id,
      is_archived: false 
    });
    
    const calculated_stock = updatedMovements.reduce((sum, m) => sum + (m.quantity || 0), 0);
    const expected_stock = Math.max(0, calculated_stock);

    console.log(`[Reconcile SKU] Current: ${before_stock}, Calculated from history: ${calculated_stock}, Expected: ${expected_stock}`);

    // Step 3: If there's still a mismatch, create a corrective movement
    if (before_stock !== expected_stock) {
      const difference = expected_stock - before_stock;
      
      console.log(`[Reconcile SKU] Mismatch detected. Creating corrective movement: ${difference}`);
      
      await base44.asServiceRole.entities.StockMovement.create({
        tenant_id: workspace_id,
        sku_id: sku.id,
        sku_code: sku.sku_code,
        movement_type: 'manual',
        quantity: difference,
        reference_type: 'manual',
        reference_id: null,
        movement_date: new Date().toISOString().split('T')[0],
        notes: `Auto-reconciliation: Adjusted stock from ${before_stock} to ${expected_stock}`,
        is_archived: false
      });
      
      created_movements++;
    }

    // Update current stock
    if (stock) {
      await base44.asServiceRole.entities.CurrentStock.update(stock.id, {
        quantity_available: expected_stock
      });
    } else {
      await base44.asServiceRole.entities.CurrentStock.create({
        tenant_id: workspace_id,
        sku_id: sku.id,
        sku_code: sku.sku_code,
        quantity_available: expected_stock
      });
    }

    // Verify - wait a moment for DB to commit
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const verify = await base44.asServiceRole.entities.CurrentStock.filter({
      tenant_id: workspace_id,
      sku_id: sku.id
    });

    console.log(`[Reconcile SKU] Final stock: ${verify[0]?.quantity_available}`);
    console.log(`[Reconcile SKU] Summary: ${created_movements} movements created, stock adjusted from ${before_stock} to ${expected_stock}`);

    return Response.json({
      ok: true,
      sku_code,
      before: before_stock,
      after: expected_stock,
      history_total: calculated_stock,
      created_movements,
      corrected: before_stock !== expected_stock || created_movements > 0
    });

  } catch (error) {
    console.error('[Reconcile SKU] Error:', error);
    return Response.json({
      ok: false,
      error: error.message || 'Reconciliation failed'
    }, { status: 500 });
  }
});