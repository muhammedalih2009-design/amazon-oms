import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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

    console.log('[deleteSettlementOrders] Input:', { workspace_id, order_ids });

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

    // POLICY: Option A - Soft-delete settlement rows linked to these orders
    // Mark settlement rows as deleted, set match_status to indicate order was deleted
    let totalAffected = 0;
    let unmatchedAfterDelete = 0;
    const affectedRowIds = [];
    
    for (const orderId of order_ids) {
      // Find all settlement rows for this order (both matched and unmatched)
      const rows = await base44.asServiceRole.entities.SettlementRow.filter({
        tenant_id: workspace_id,
        order_id: orderId,
        is_deleted: false
      });

      console.log(`[deleteSettlementOrders] Order ${orderId}: found ${rows.length} active rows`);

      for (const row of rows) {
        affectedRowIds.push(row.id);
        await base44.asServiceRole.entities.SettlementRow.update(row.id, {
          is_deleted: true,
          deleted_at: new Date().toISOString(),
          match_status: 'unmatched_order', // Reset to unmatched since order linkage is removed
          matched_order_id: null // Clear order linkage
        });
        totalAffected++;
        unmatchedAfterDelete++;
      }
    }
    
    console.log('[deleteSettlementOrders] Result:', {
      ordersProcessed: order_ids.length,
      settlementRowsAffected: totalAffected,
      affectedRowIds: affectedRowIds.slice(0, 10),
      unmatchedAfterDelete
    });

    if (totalAffected === 0) {
      return Response.json({
        success: true,
        deleted_count: order_ids.length,
        affected_settlement_rows: 0,
        unmatched_after_delete: 0,
        message: 'No linked settlement rows found for provided order IDs'
      });
    }

    return Response.json({
      success: true,
      deleted_count: order_ids.length,
      affected_settlement_rows: totalAffected,
      unmatched_after_delete: unmatchedAfterDelete,
      message: `Deleted ${order_ids.length} order${order_ids.length > 1 ? 's' : ''}, updated ${totalAffected} settlement row${totalAffected > 1 ? 's' : ''}, ${unmatchedAfterDelete} now unmatched`
    });
  } catch (error) {
    console.error('[deleteSettlementOrders] Error:', error);
    return Response.json({ code: 'ERROR', message: error.message }, { status: 500 });
  }
});