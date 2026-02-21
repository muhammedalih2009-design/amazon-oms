import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id, sku_codes } = await req.json();

    if (!workspace_id || !sku_codes?.length) {
      return Response.json({ 
        ok: false, 
        error: 'workspace_id and sku_codes array required' 
      }, { status: 400 });
    }

    console.log(`[Bulk Reconcile] Starting bulk reconciliation for ${sku_codes.length} SKUs to stock 0`);

    let reconciled_count = 0;

    // Call fixStockIssuesForSku for each SKU
    for (const sku_code of sku_codes) {
      try {
        const result = await base44.asServiceRole.functions.invoke('fixStockIssuesForSku', {
          workspace_id,
          sku_code
        });

        if (result.ok) {
          reconciled_count++;
          console.log(`[Bulk Reconcile] ✓ ${sku_code}: ${result.before} → ${result.after}`);
        } else {
          console.warn(`[Bulk Reconcile] Failed for ${sku_code}: ${result.error}`);
        }
      } catch (skuError) {
        console.error(`[Bulk Reconcile] Error reconciling ${sku_code}:`, skuError);
      }
    }

    console.log(`[Bulk Reconcile] Complete: Reconciled ${reconciled_count}/${sku_codes.length} SKUs`);

    return Response.json({
      ok: true,
      reconciled_count,
      total_skus: sku_codes.length
    });

  } catch (error) {
    console.error('[Bulk Reconcile] Error:', error);
    return Response.json({
      ok: false,
      error: error.message || 'Bulk reconciliation failed'
    }, { status: 500 });
  }
});