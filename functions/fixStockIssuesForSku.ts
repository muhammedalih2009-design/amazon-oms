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

    console.log(`[Fix SKU] Starting fix for ${sku_code} in workspace ${workspace_id}`);

    // Fetch all data for this SKU
    const [skus, currentStock, movements, orders, orderLines] = await Promise.all([
      base44.asServiceRole.entities.SKU.filter({ tenant_id: workspace_id, sku_code }),
      base44.asServiceRole.entities.CurrentStock.filter({ tenant_id: workspace_id, sku_code }),
      base44.asServiceRole.entities.StockMovement.filter({ tenant_id: workspace_id, sku_code, is_archived: false }),
      base44.asServiceRole.entities.Order.filter({ tenant_id: workspace_id, status: 'fulfilled' }),
      base44.asServiceRole.entities.OrderLine.filter({ tenant_id: workspace_id, sku_code, is_returned: false })
    ]);

    const sku = skus[0];
    if (!sku) {
      return Response.json({ ok: false, error: 'SKU not found' }, { status: 404 });
    }

    const stock = currentStock[0];
    const before_stock = stock?.quantity_available || 0;
    const before_movements_count = movements.length;

    console.log(`[Fix SKU] Before: stock=${before_stock}, movements=${before_movements_count}`);

    // Calculate expected stock from movement history
    const calculated_stock = movements.reduce((sum, m) => sum + (m.quantity || 0), 0);

    const fixedIssues = [];
    let createdMovementsCount = 0;

    // Fix 1: Create missing OUT movements for fulfilled orders
    const fulfilledOrderIds = new Set(orders.map(o => o.id));
    const linesForFulfilledOrders = orderLines.filter(line => 
      line.sku_id === sku.id && fulfilledOrderIds.has(line.order_id)
    );

    for (const line of linesForFulfilledOrders) {
      const hasMovement = movements.some(m => 
        m.reference_type === 'order_line' && 
        m.reference_id === line.id &&
        m.movement_type === 'order_fulfillment'
      );

      if (!hasMovement) {
        // Create missing movement (idempotent - check again before insert)
        const doubleCheck = await base44.asServiceRole.entities.StockMovement.filter({
          tenant_id: workspace_id,
          reference_type: 'order_line',
          reference_id: line.id,
          movement_type: 'order_fulfillment'
        });

        if (doubleCheck.length === 0) {
          await base44.asServiceRole.entities.StockMovement.create({
            tenant_id: workspace_id,
            sku_id: sku.id,
            sku_code: sku.sku_code,
            movement_type: 'order_fulfillment',
            quantity: -line.quantity,
            reference_type: 'order_line',
            reference_id: line.id,
            movement_date: orders.find(o => o.id === line.order_id)?.order_date || new Date().toISOString().split('T')[0],
            notes: `Auto-fix: Missing OUT movement for fulfilled order`,
            is_archived: false
          });
          createdMovementsCount++;
          fixedIssues.push('missing_out_movement');
          console.log(`[Fix SKU] Created missing OUT movement for order line ${line.id}`);
        }
      }
    }

    // Recalculate stock after creating movements
    const allMovementsNow = await base44.asServiceRole.entities.StockMovement.filter({
      tenant_id: workspace_id,
      sku_code,
      is_archived: false
    });
    
    const expected_stock = Math.max(0, allMovementsNow.reduce((sum, m) => sum + (m.quantity || 0), 0));

    // Fix 2: Force current stock to match expected (clamp to 0)
    if (stock) {
      if (stock.quantity_available !== expected_stock) {
        await base44.asServiceRole.entities.CurrentStock.update(stock.id, {
          quantity_available: expected_stock
        });
        fixedIssues.push('stock_mismatch');
        console.log(`[Fix SKU] Updated stock: ${stock.quantity_available} → ${expected_stock}`);
      }
    } else {
      // Create stock record if missing
      await base44.asServiceRole.entities.CurrentStock.create({
        tenant_id: workspace_id,
        sku_id: sku.id,
        sku_code: sku.sku_code,
        quantity_available: expected_stock
      });
      fixedIssues.push('missing_stock_record');
      console.log(`[Fix SKU] Created stock record with quantity ${expected_stock}`);
    }

    // Fix 3: Negative stock is already handled by clamping to 0
    if (expected_stock === 0 && calculated_stock < 0) {
      fixedIssues.push('negative_stock_clamped');
    }

    const after_stock = expected_stock;
    const after_movements_count = allMovementsNow.length;

    console.log(`[Fix SKU] After: stock=${after_stock}, movements=${after_movements_count}, created=${createdMovementsCount}`);

    // Log audit entry
    console.log(`[Fix SKU] Audit: ${JSON.stringify({
      action: 'STOCK_FIX_NOW',
      sku_code,
      workspace_id,
      user: user.email,
      before_values: { stock: before_stock, movements: before_movements_count },
      after_values: { stock: after_stock, movements: after_movements_count },
      fixed_issue_types: [...new Set(fixedIssues)],
      created_movements_count: createdMovementsCount
    })}`);

    return Response.json({
      ok: true,
      sku_code,
      fixed_issues: [...new Set(fixedIssues)],
      before: { stock: before_stock, movements: before_movements_count },
      after: { stock: after_stock, movements: after_movements_count },
      created_movements: createdMovementsCount
    });

  } catch (error) {
    console.error('[Fix SKU] Error:', error);
    return Response.json({
      ok: false,
      error: error.message || 'Fix failed'
    }, { status: 500 });
  }
});