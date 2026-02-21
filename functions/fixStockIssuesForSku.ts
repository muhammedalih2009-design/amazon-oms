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
    const [skus, currentStock, movements] = await Promise.all([
      base44.asServiceRole.entities.SKU.filter({ tenant_id: workspace_id, sku_code }),
      base44.asServiceRole.entities.CurrentStock.filter({ tenant_id: workspace_id, sku_code }),
      base44.asServiceRole.entities.StockMovement.filter({ tenant_id: workspace_id, sku_code, is_archived: false })
    ]);

    const sku = skus[0];
    if (!sku) {
      return Response.json({ ok: false, error: 'SKU not found' }, { status: 404 });
    }

    const stock = currentStock[0];
    const before_stock = stock?.quantity_available || 0;
    const before_movements_count = movements.length;

    // Calculate what stock should be based on movement history
    const calculated_stock = movements.reduce((sum, m) => sum + (m.quantity || 0), 0);
    const expected_stock = Math.max(0, calculated_stock);

    console.log(`[Reconcile SKU] Current: ${before_stock}, Calculated from history: ${calculated_stock}, Expected: ${expected_stock}`);

    // If there's a mismatch, create a corrective movement
    if (before_stock !== expected_stock) {
      const difference = expected_stock - before_stock;
      
      console.log(`[Reconcile SKU] Mismatch detected. Creating corrective movement: ${difference}`);
      
      // Create corrective movement
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

    // Verify
    const verify = await base44.asServiceRole.entities.CurrentStock.filter({
      tenant_id: workspace_id,
      sku_id: sku.id
    });

    console.log(`[Reconcile SKU] Final stock: ${verify[0]?.quantity_available}`);

    return Response.json({
      ok: true,
      sku_code,
      before: before_stock,
      after: expected_stock,
      history_total: calculated_stock,
      corrected: before_stock !== expected_stock
    });

  } catch (error) {
    console.error('[Reconcile SKU] Error:', error);
    return Response.json({
      ok: false,
      error: error.message || 'Reconciliation failed'
    }, { status: 500 });
  }
});