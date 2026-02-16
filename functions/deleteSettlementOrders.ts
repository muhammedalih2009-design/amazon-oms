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

    let totalDeleted = 0;
    
    for (const orderId of order_ids) {
      const rows = await base44.asServiceRole.entities.SettlementRow.filter({
        tenant_id: workspace_id,
        order_id: orderId,
        is_deleted: false
      });

      for (const row of rows) {
        await base44.asServiceRole.entities.SettlementRow.update(row.id, {
          is_deleted: true,
          deleted_at: new Date().toISOString()
        });
        totalDeleted++;
      }
    }

    return Response.json({
      success: true,
      deleted_count: order_ids.length,
      affected_settlement_rows: totalDeleted
    });
  } catch (error) {
    console.error('Delete error:', error);
    return Response.json({ code: 'ERROR', message: error.message }, { status: 500 });
  }
});