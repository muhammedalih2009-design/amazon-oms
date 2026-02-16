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

    // Process each order ID and soft delete its settlement rows
    let deletedRowsCount = 0;
    
    for (const orderId of order_ids) {
      // Fetch only rows for this specific order
      const orderRows = await base44.asServiceRole.entities.SettlementRow.filter({
        tenant_id: workspace_id,
        order_id: orderId,
        is_deleted: false
      });

      console.log(`[DeleteOrders] Order ${orderId}: Found ${orderRows.length} rows to delete`);

      // Update in batches
      const BATCH_SIZE = 50;
      for (let i = 0; i < orderRows.length; i += BATCH_SIZE) {
        const batch = orderRows.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(row =>
            base44.asServiceRole.entities.SettlementRow.update(row.id, {
              is_deleted: true,
              deleted_at: new Date().toISOString()
            })
          )
        );
        deletedRowsCount += batch.length;
        
        // Rate limiting between batches
        if (i + BATCH_SIZE < orderRows.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      // Small delay between orders
      if (order_ids.indexOf(orderId) < order_ids.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    console.log(`[DeleteOrders] Successfully soft deleted ${deletedRowsCount} settlement rows across ${order_ids.length} orders`);

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