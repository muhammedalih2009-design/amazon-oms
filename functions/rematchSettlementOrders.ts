import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { normalizeOrderId } from './helpers/normalizeOrderId.js';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tenantId, settlementOrderIds } = await req.json();
    
    if (!tenantId || !settlementOrderIds || settlementOrderIds.length === 0) {
      return Response.json({ error: 'tenantId and settlementOrderIds required' }, { status: 400 });
    }

    console.log(`🔄 REMATCH SETTLEMENT ORDERS: tenantId=${tenantId}, count=${settlementOrderIds.length}`);

    // Verify access
    const membership = await base44.entities.Membership.filter({
      tenant_id: tenantId,
      user_email: user.email
    });

    if (membership.length === 0) {
      return Response.json({ error: 'Access denied' }, { status: 403 });
    }

    // Get all orders for this workspace
    const allOrders = await base44.asServiceRole.entities.Order.filter({ 
      tenant_id: tenantId 
    });

    // TASK 5: Build normalized order ID map for consistent matching
    const orderMap = new Map();
    for (const order of allOrders) {
      const normalized = normalizeOrderId(order.amazon_order_id);
      orderMap.set(normalized, order);
    }

    let matchedCount = 0;
    let notFoundCount = 0;
    const results = [];

    for (const settlementOrderId of settlementOrderIds) {
      // TASK 5: Use normalized matching
      const normalized = normalizeOrderId(settlementOrderId);
      const matchedOrder = orderMap.get(normalized);

      if (matchedOrder) {
        // Store the match result with normalized ID and strategy
        results.push({
          settlement_order_id: settlementOrderId,
          matched_order_id: matchedOrder.id,
          amazon_order_id: matchedOrder.amazon_order_id,
          normalized_order_id: normalized,
          match_strategy: 'normalized',
          status: 'matched'
        });
        matchedCount++;
      } else {
        results.push({
          settlement_order_id: settlementOrderId,
          normalized_order_id: normalized,
          match_strategy: 'normalized',
          status: 'not_found'
        });
        notFoundCount++;
      }
    }

    console.log(`✅ REMATCH COMPLETE: matched=${matchedCount}, not_found=${notFoundCount}`);

    return Response.json({
      success: true,
      stats: {
        total: settlementOrderIds.length,
        matched: matchedCount,
        not_found: notFoundCount
      },
      results
    });

  } catch (error) {
    console.error('Rematch settlement orders error:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});