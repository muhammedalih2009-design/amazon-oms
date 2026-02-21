import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id, target_stock, sku_codes } = await req.json();

    if (!workspace_id || !sku_codes?.length || target_stock === undefined) {
      return Response.json({ 
        ok: false, 
        error: 'workspace_id, sku_codes array, and target_stock required' 
      }, { status: 400 });
    }

    console.log(`[Bulk Reconcile] Reconciling ${sku_codes.length} SKUs to stock ${target_stock}`);

    const [skus, movements, currentStocks] = await Promise.all([
      base44.asServiceRole.entities.SKU.filter({ tenant_id: workspace_id }),
      base44.asServiceRole.entities.StockMovement.filter({ tenant_id: workspace_id }),
      base44.asServiceRole.entities.CurrentStock.filter({ tenant_id: workspace_id })
    ]);

    let reconciled_count = 0;

    // Reconcile each affected SKU
    for (const sku_code of sku_codes) {
      try {
        const sku = skus.find(s => s.sku_code === sku_code);
        if (!sku) continue;

        // Get active movements for this SKU
        const activeMovements = movements.filter(m => m.sku_id === sku.id && !m.is_archived);
        const currentStock = currentStocks.find(s => s.sku_id === sku.id);
        
        const before = currentStock?.quantity_available || 0;
        const historyTotal = activeMovements.reduce((sum, m) => sum + (m.quantity || 0), 0);
        
        // Create corrective movement if needed
        const difference = target_stock - historyTotal;
        
        if (difference !== 0) {
          await base44.asServiceRole.entities.StockMovement.create({
            tenant_id: workspace_id,
            sku_id: sku.id,
            sku_code: sku.sku_code,
            movement_type: 'manual',
            quantity: difference,
            reference_type: 'manual',
            movement_date: new Date().toISOString().split('T')[0],
            notes: `Bulk reconciliation: Set stock to ${target_stock}`,
            is_archived: false
          });
        }

        // Update current stock
        if (currentStock) {
          await base44.asServiceRole.entities.CurrentStock.update(currentStock.id, {
            quantity_available: target_stock
          });
        } else {
          await base44.asServiceRole.entities.CurrentStock.create({
            tenant_id: workspace_id,
            sku_id: sku.id,
            sku_code: sku.sku_code,
            quantity_available: target_stock
          });
        }

        reconciled_count++;
        console.log(`[Bulk Reconcile] ✓ ${sku_code}: ${before} → ${target_stock}`);

      } catch (err) {
        console.error(`[Bulk Reconcile] Error with ${sku_code}:`, err);
      }
    }

    console.log(`[Bulk Reconcile] Done: ${reconciled_count}/${sku_codes.length} reconciled`);

    return Response.json({
      ok: true,
      reconciled_count,
      total_skus: sku_codes.length
    });

  } catch (error) {
    console.error('[Bulk Reconcile] Error:', error);
    return Response.json({
      ok: false,
      error: error.message
    }, { status: 500 });
  }
});