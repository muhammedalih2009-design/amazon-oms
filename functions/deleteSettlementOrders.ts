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

    console.log('[deleteSettlementOrders] Request:', { workspace_id, order_ids });

    // Verify membership and admin
    const membership = await base44.asServiceRole.entities.Membership.filter({
      tenant_id: workspace_id,
      user_id: user.id
    });

    if (membership.length === 0) {
      return Response.json({ code: 'FORBIDDEN', message: 'No access to workspace' }, { status: 403 });
    }

    const isAdmin = membership[0].role === 'owner' || membership[0].role === 'admin';
    if (!isAdmin && user.role !== 'admin') {
      return Response.json({ code: 'FORBIDDEN', message: 'Admin access required' }, { status: 403 });
    }

    // Fetch all active settlement rows for this workspace
    const allRows = await base44.asServiceRole.entities.SettlementRow.filter({
      tenant_id: workspace_id,
      is_deleted: false
    });

    console.log(`[deleteSettlementOrders] Total active rows: ${allRows.length}`);

    // Map rows by normalized order_id for efficient lookup
    const rowsByNormalizedId = {};
    allRows.forEach(row => {
      const normalized = normalizeOrderId(row.order_id);
      if (!rowsByNormalizedId[normalized]) {
        rowsByNormalizedId[normalized] = [];
      }
      rowsByNormalizedId[normalized].push(row);
    });

    let deletedCount = 0;
    const diagnosticInfo = [];

    // Process each input order ID using canonical matching
    for (const inputOrderId of order_ids) {
      const normalizedInput = normalizeOrderId(inputOrderId);
      const matchingRows = rowsByNormalizedId[normalizedInput] || [];

      console.log(`[deleteSettlementOrders] Processing ${inputOrderId}, normalized: ${normalizedInput}, found: ${matchingRows.length} rows`);

      diagnosticInfo.push({
        input_order_id: inputOrderId,
        normalized: normalizedInput,
        rows_found: matchingRows.length
      });

      for (const row of matchingRows) {
        await base44.asServiceRole.entities.SettlementRow.update(row.id, {
          is_deleted: true,
          deleted_at: new Date().toISOString(),
          match_status: 'unmatched_order',
          matched_order_id: null,
          matched_sku_id: null,
          not_found_reason: 'Order deleted by user'
        });
        deletedCount++;
      }
    }

    console.log('[deleteSettlementOrders] Result:', { deletedCount, diagnosticInfo });

    return Response.json({
      success: true,
      deleted_count: deletedCount,
      message: `Successfully deleted ${deletedCount} settlement row${deletedCount > 1 ? 's' : ''}`,
      diagnostic: diagnosticInfo
    });
  } catch (error) {
    console.error('[deleteSettlementOrders] Error:', error);
    return Response.json({
      code: 'ERROR',
      message: error.message
    }, { status: 500 });
  }
});