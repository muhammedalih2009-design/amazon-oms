import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { normalizeOrderId } from './helpers/normalizeOrderId.js';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tenantId, orderIds } = await req.json();
    
    if (!tenantId || !orderIds || orderIds.length === 0) {
      return Response.json({ error: 'tenantId and orderIds required' }, { status: 400 });
    }

    console.log(`♻️ RESTORE SETTLEMENT ORDERS: tenantId=${tenantId}, count=${orderIds.length}`);

    // Verify access
    const membership = await base44.entities.Membership.filter({
      tenant_id: tenantId,
      user_email: user.email
    });

    if (membership.length === 0) {
      return Response.json({ error: 'Access denied' }, { status: 403 });
    }

    // Fetch deleted orders
    const orders = await base44.asServiceRole.entities.Order.filter({
      tenant_id: tenantId,
      id: { $in: orderIds },
      is_deleted: true
    });

    let restoredCount = 0;

    // TASK 5: Restore with consistent normalized ID handling
    for (const order of orders) {
      const normalizedOrderId = normalizeOrderId(order.amazon_order_id);
      
      await base44.asServiceRole.entities.Order.update(order.id, {
        is_deleted: false,
        deleted_at: null,
        deleted_by: null,
        delete_reason: null,
        normalized_order_id: normalizedOrderId, // TASK 5: Ensure normalized ID is set
        match_strategy: order.match_strategy || 'normalized' // TASK 5: Preserve or set match strategy
      });

      restoredCount++;
    }

    console.log(`✅ RESTORE COMPLETE: restored=${restoredCount}`);

    return Response.json({
      success: true,
      restored: restoredCount
    });

  } catch (error) {
    console.error('Restore settlement orders error:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});