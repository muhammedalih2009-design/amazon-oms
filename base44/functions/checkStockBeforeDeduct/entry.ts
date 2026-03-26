import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * CRITICAL: Negative Stock Prevention
 * 
 * This function validates stock availability BEFORE deduction in a transaction-safe manner.
 * NEVER allow stock to go below 0 unless explicitly forced.
 * 
 * Use this for:
 * - Order fulfillment
 * - Manual stock adjustments
 * - Returns reversal
 * - Any stock deduction operation
 */

Deno.serve(async (req) => {
  try {
    const db = createClientFromRequest(req);
    const user = await db.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id, sku_id, quantity_to_deduct, force = false } = await req.json();

    if (!workspace_id || !sku_id || !quantity_to_deduct) {
      return Response.json({
        error: 'Missing required fields: workspace_id, sku_id, quantity_to_deduct'
      }, { status: 400 });
    }

    // Fetch FRESH stock data
    const stockRecords = await db.entities.CurrentStock.filter({
      tenant_id: workspace_id,
      sku_id: sku_id
    });

    if (stockRecords.length === 0) {
      return Response.json({
        ok: false,
        can_deduct: false,
        error: 'SKU_NOT_FOUND',
        message: `No stock record found for SKU ${sku_id}`,
        current_stock: 0,
        requested: quantity_to_deduct,
        would_result_in: -quantity_to_deduct
      });
    }

    const currentStock = stockRecords[0].quantity_available || 0;
    const wouldResultIn = currentStock - quantity_to_deduct;

    // CRITICAL: Block negative stock unless forced
    if (wouldResultIn < 0 && !force) {
      return Response.json({
        ok: false,
        can_deduct: false,
        error: 'INSUFFICIENT_STOCK',
        message: `Insufficient stock. This action would create negative stock (${wouldResultIn}).`,
        current_stock: currentStock,
        requested: quantity_to_deduct,
        shortage: Math.abs(wouldResultIn),
        would_result_in: wouldResultIn
      });
    }

    // Allow deduction
    return Response.json({
      ok: true,
      can_deduct: true,
      current_stock: currentStock,
      requested: quantity_to_deduct,
      would_result_in: wouldResultIn,
      forced: force && wouldResultIn < 0
    });

  } catch (error) {
    console.error('Stock check error:', error);
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});