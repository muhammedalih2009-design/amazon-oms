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
    const { workspace_id, order_ids } = body;

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
        message: 'Only workspace admins can restore orders',
        details: []
      }, { status: 403 });
    }

    // Fetch deleted settlement rows for these order_ids
    const allSettlementRows = await base44.asServiceRole.entities.SettlementRow.filter({
      tenant_id: workspace_id
    });

    const rowsToRestore = allSettlementRows.filter(row => 
      order_ids.includes(row.order_id) && row.is_deleted
    );

    console.log(`[RestoreOrders] Restoring ${order_ids.length} orders, affecting ${rowsToRestore.length} settlement rows`);

    // Restore settlement rows in batches
    const BATCH_SIZE = 50;
    let restoredRowsCount = 0;

    for (let i = 0; i < rowsToRestore.length; i += BATCH_SIZE) {
      const batch = rowsToRestore.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(row =>
          base44.asServiceRole.entities.SettlementRow.update(row.id, {
            is_deleted: false,
            deleted_at: null
          })
        )
      );
      restoredRowsCount += batch.length;
      
      // Rate limiting
      if (i + BATCH_SIZE < rowsToRestore.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`[RestoreOrders] Restored ${restoredRowsCount} settlement rows`);

    return Response.json({
      success: true,
      restored_count: order_ids.length,
      affected_settlement_rows: restoredRowsCount,
      order_ids: order_ids
    });
  } catch (error) {
    console.error('Restore settlement orders error:', error);
    return Response.json({
      code: 'RESTORE_ERROR',
      message: error.message,
      details: []
    }, { status: 500 });
  }
});