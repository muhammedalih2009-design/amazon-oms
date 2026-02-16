import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Authenticate
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({
        code: 'UNAUTHORIZED',
        message: 'Not authenticated',
        details: []
      }, { status: 401 });
    }

    // Parse request
    const body = await req.json();
    const { workspace_id, order_ids, reason } = body;

    if (!workspace_id || !order_ids || !Array.isArray(order_ids) || order_ids.length === 0) {
      return Response.json({
        code: 'VALIDATION_ERROR',
        message: 'Missing required fields: workspace_id and order_ids (non-empty array)',
        details: []
      }, { status: 400 });
    }

    // Check workspace membership and admin permission
    const membership = await base44.asServiceRole.entities.Membership.filter({
      tenant_id: workspace_id,
      user_id: user.id
    });

    if (membership.length === 0) {
      return Response.json({
        code: 'FORBIDDEN',
        message: 'No access to this workspace',
        details: []
      }, { status: 403 });
    }

    const userRole = membership[0].role;
    const isAdmin = userRole === 'owner' || userRole === 'admin';
    const isPlatformAdmin = user.role === 'admin';

    if (!isAdmin && !isPlatformAdmin) {
      return Response.json({
        code: 'FORBIDDEN',
        message: 'Only workspace admins can delete orders',
        details: []
      }, { status: 403 });
    }

    // Fetch settlement rows for these order_ids
    const allSettlementRows = await base44.asServiceRole.entities.SettlementRow.filter({
      tenant_id: workspace_id
    });

    const rowsToDelete = allSettlementRows.filter(row => 
      order_ids.includes(row.order_id) && !row.is_deleted
    );

    console.log(`[DeleteOrders] Deleting ${order_ids.length} orders, affecting ${rowsToDelete.length} settlement rows`);

    // Soft delete settlement rows in batches
    const BATCH_SIZE = 50;
    let deletedRowsCount = 0;

    for (let i = 0; i < rowsToDelete.length; i += BATCH_SIZE) {
      const batch = rowsToDelete.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(row =>
          base44.asServiceRole.entities.SettlementRow.update(row.id, {
            is_deleted: true,
            deleted_at: new Date().toISOString()
          })
        )
      );
      deletedRowsCount += batch.length;
      
      // Rate limiting
      if (i + BATCH_SIZE < rowsToDelete.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`[DeleteOrders] Soft deleted ${deletedRowsCount} settlement rows`);

    return Response.json({
      success: true,
      deleted_count: order_ids.length,
      affected_settlement_rows: deletedRowsCount,
      order_ids: order_ids
    });
  } catch (error) {
    console.error('Delete settlement orders error:', error);
    return Response.json({
      code: 'DELETE_ERROR',
      message: error.message,
      details: []
    }, { status: 500 });
  }
});