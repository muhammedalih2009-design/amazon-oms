import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { normalizeOrderId } from './helpers/normalizeOrderId.js';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tenantId, orderIds, reason } = await req.json();
    
    if (!tenantId || !orderIds || orderIds.length === 0) {
      return Response.json({ error: 'tenantId and orderIds required' }, { status: 400 });
    }

    console.log(`🗑️ DELETE SETTLEMENT ORDERS: tenantId=${tenantId}, count=${orderIds.length}`);

    // Verify access
    const membership = await base44.entities.Membership.filter({
      tenant_id: tenantId,
      user_email: user.email
    });

    if (membership.length === 0) {
      return Response.json({ error: 'Access denied' }, { status: 403 });
    }

    // Fetch orders to delete
    const orders = await base44.asServiceRole.entities.Order.filter({
      tenant_id: tenantId,
      id: { $in: orderIds }
    });

    let deletedCount = 0;

    // TASK 5: Store normalized IDs for audit trail
    for (const order of orders) {
      const normalizedOrderId = normalizeOrderId(order.amazon_order_id);
      
      // Soft delete with audit trail
      await base44.asServiceRole.entities.Order.update(order.id, {
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: user.email,
        delete_reason: reason || 'Manual deletion',
        normalized_order_id: normalizedOrderId, // TASK 5: Persist normalized ID
        match_strategy: 'normalized' // TASK 5: Persist match strategy
      });

      deletedCount++;
    }

    console.log(`✅ DELETE COMPLETE: deleted=${deletedCount}`);

    return Response.json({
      success: true,
      deleted: deletedCount
    });

  } catch (error) {
    console.error('Delete settlement orders error:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});