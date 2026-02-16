import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { normalizeOrderId } from './helpers/normalizeOrderId.js';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ code: 'UNAUTHORIZED', message: 'Not authenticated' }, { status: 401 });
    }

    const body = await req.json();
    const { workspace_id, order_ids } = body;

    if (!workspace_id || !order_ids || !Array.isArray(order_ids) || order_ids.length === 0) {
      return Response.json({ code: 'VALIDATION_ERROR', message: 'Missing workspace_id or order_ids' }, { status: 400 });
    }

    const membership = await base44.asServiceRole.entities.Membership.filter({
      tenant_id: workspace_id,
      user_id: user.id
    });

    if (membership.length === 0) {
      return Response.json({ code: 'FORBIDDEN', message: 'No access' }, { status: 403 });
    }

    const isAdmin = membership[0].role === 'owner' || membership[0].role === 'admin';
    if (!isAdmin && user.role !== 'admin') {
      return Response.json({ code: 'FORBIDDEN', message: 'Admin only' }, { status: 403 });
    }

    let totalRestored = 0;
    let rematched = 0;
    
    // Get orders and SKUs for rematching
    const [orders, skus, orderLines] = await Promise.all([
      base44.asServiceRole.entities.Order.filter({ tenant_id: workspace_id, is_deleted: false }),
      base44.asServiceRole.entities.SKU.filter({ tenant_id: workspace_id }),
      base44.asServiceRole.entities.OrderLine.filter({ tenant_id: workspace_id })
    ]);
    
    for (const orderId of order_ids) {
      const rows = await base44.asServiceRole.entities.SettlementRow.filter({
        tenant_id: workspace_id,
        order_id: orderId,
        is_deleted: true
      });

      console.log(`[restoreSettlementOrders] Order ${orderId}: found ${rows.length} deleted rows`);

      for (const row of rows) {
        // Rematch with canonical normalization
        let matchStatus = 'unmatched_order';
        let matchedOrderId = null;
        let matchedSkuId = null;
        let matchStrategy = null;
        let notFoundReason = 'Order not found after normalization';

        const normalizedRowOrderId = normalizeOrderId(row.order_id);
        const matchedOrder = orders.find(o => normalizeOrderId(o.amazon_order_id) === normalizedRowOrderId);
        
        if (matchedOrder) {
          matchedOrderId = matchedOrder.id;
          matchStrategy = 'normalized_amazon_id';
          
          const matchedSku = skus.find(s => 
            s.sku_code === row.sku ||
            normalizeOrderId(s.sku_code) === normalizeOrderId(row.sku)
          );
          
          if (matchedSku) {
            matchedSkuId = matchedSku.id;
            matchStatus = 'matched';
            rematched++;
            notFoundReason = null;
            
            // Check COGS
            if (!matchedOrder.total_cost || matchedOrder.total_cost === 0) {
              const lines = orderLines.filter(l => l.order_id === matchedOrder.id);
              const computedCogs = lines.reduce((sum, l) => sum + ((l.unit_cost || 0) * (l.quantity || 0)), 0);
              
              if (computedCogs === 0) {
                notFoundReason = 'Order matched but COGS missing';
              }
            }
          } else {
            // Keep matched_order_id even if SKU missing
            matchStatus = 'unmatched_sku';
            notFoundReason = 'Order matched, SKU not found';
          }
        }

        await base44.asServiceRole.entities.SettlementRow.update(row.id, {
          is_deleted: false,
          deleted_at: null,
          matched_order_id: matchedOrderId,
          matched_sku_id: matchedSkuId,
          match_status: matchStatus,
          match_strategy: matchStrategy,
          match_confidence: matchedOrderId ? 'high' : null,
          not_found_reason: notFoundReason
        });
        totalRestored++;
      }
    }
    
    console.log('[restoreSettlementOrders] Result:', { totalRestored, rematched });

    return Response.json({
      success: true,
      restored_count: order_ids.length,
      affected_settlement_rows: totalRestored,
      rematched_count: rematched,
      message: `Restored ${totalRestored} settlement row${totalRestored > 1 ? 's' : ''}, ${rematched} rematched with orders`
    });
  } catch (error) {
    console.error('Restore error:', error);
    return Response.json({ code: 'ERROR', message: error.message }, { status: 500 });
  }
});