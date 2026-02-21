import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id, target_stock, sku_codes } = await req.json();

    if (!workspace_id || sku_codes?.length === 0 || target_stock === undefined) {
      return Response.json({ 
        ok: false, 
        error: 'workspace_id, sku_codes array, and target_stock required' 
      }, { status: 400 });
    }

    console.log(`[Bulk Reconcile] Starting bulk reconciliation for ${sku_codes.length} SKUs to stock ${target_stock}`);

    let reconciled_count = 0;

    for (const sku_code of sku_codes) {
      try {
        // Fetch SKU data
        const [skus, currentStock] = await Promise.all([
          base44.asServiceRole.entities.SKU.filter({ tenant_id: workspace_id, sku_code }),
          base44.asServiceRole.entities.CurrentStock.filter({ tenant_id: workspace_id, sku_code })
        ]);

        const sku = skus[0];
        if (!sku) {
          console.log(`[Bulk Reconcile] SKU not found: ${sku_code}`);
          continue;
        }

        const stock = currentStock[0];
        const before_stock = stock?.quantity_available || 0;

        // Create corrective movement if needed
        if (before_stock !== target_stock) {
          const difference = target_stock - before_stock;
          
          await base44.asServiceRole.entities.StockMovement.create({
            tenant_id: workspace_id,
            sku_id: sku.id,
            sku_code: sku.sku_code,
            movement_type: 'manual',
            quantity: difference,
            reference_type: 'manual',
            reference_id: null,
            movement_date: new Date().toISOString().split('T')[0],
            notes: `Bulk reconciliation: Adjusted stock from ${before_stock} to ${target_stock}`,
            is_archived: false
          });
        }

        // Update current stock
        if (stock) {
          await base44.asServiceRole.entities.CurrentStock.update(stock.id, {
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
        console.log(`[Bulk Reconcile] ✓ Reconciled ${sku_code}: ${before_stock} → ${target_stock}`);

      } catch (skuError) {
        console.error(`[Bulk Reconcile] Error reconciling ${sku_code}:`, skuError);
      }
    }

    console.log(`[Bulk Reconcile] Complete: Reconciled ${reconciled_count}/${sku_codes.length} SKUs`);

    return Response.json({
      ok: true,
      reconciled_count,
      total_skus: sku_codes.length,
      target_stock
    });

  } catch (error) {
    console.error('[Bulk Reconcile] Error:', error);
    return Response.json({
      ok: false,
      error: error.message || 'Bulk reconciliation failed'
    }, { status: 500 });
  }
});