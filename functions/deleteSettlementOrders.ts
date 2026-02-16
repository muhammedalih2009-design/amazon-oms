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

    // Normalize order ID helper
    const normalizeOrderId = (orderId) => {
      if (!orderId) return '';
      return String(orderId)
        .trim()
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width chars
        .replace(/\s+/g, '') // Remove whitespace
        .toUpperCase();
    };

    // Get all active settlement rows for workspace
    const allRows = await base44.asServiceRole.entities.SettlementRow.filter({
      tenant_id: workspace_id,
      is_deleted: false
    });

    console.log(`[deleteSettlementOrders] Total active settlement rows in workspace: ${allRows.length}`);

    // Build normalized lookup map
    const rowsByNormalizedOrderId = new Map();
    allRows.forEach(row => {
      const normalized = normalizeOrderId(row.order_id);
      if (!rowsByNormalizedOrderId.has(normalized)) {
        rowsByNormalizedOrderId.set(normalized, []);
      }
      rowsByNormalizedOrderId.get(normalized).push(row);
    });

    // Process deletions with normalization
    let totalAffected = 0;
    let unmatchedAfterDelete = 0;
    const affectedRowIds = [];
    const matchedOrderIds = [];
    const unmatchedOrderIds = [];
    
    for (const orderId of order_ids) {
      const normalized = normalizeOrderId(orderId);
      const matchingRows = rowsByNormalizedOrderId.get(normalized) || [];

      console.log(`[deleteSettlementOrders] Order ${orderId} (normalized: ${normalized}): found ${matchingRows.length} rows`);

      if (matchingRows.length === 0) {
        unmatchedOrderIds.push(orderId);
        continue;
      }

      matchedOrderIds.push(orderId);

      for (const row of matchingRows) {
        affectedRowIds.push(row.id);
        await base44.asServiceRole.entities.SettlementRow.update(row.id, {
          is_deleted: true,
          deleted_at: new Date().toISOString(),
          match_status: 'unmatched_order',
          matched_order_id: null
        });
        totalAffected++;
        unmatchedAfterDelete++;
      }
    }
    
    console.log('[deleteSettlementOrders] Result:', {
      ordersProcessed: order_ids.length,
      matchedOrderIds,
      unmatchedOrderIds,
      settlementRowsAffected: totalAffected,
      affectedRowIds: affectedRowIds.slice(0, 10),
      unmatchedAfterDelete
    });

    if (totalAffected === 0) {
      // Log sample order IDs from settlement rows for debugging
      const sampleOrderIds = Array.from(rowsByNormalizedOrderId.keys()).slice(0, 5);
      console.log('[deleteSettlementOrders] No matches found. Sample settlement order IDs:', sampleOrderIds);
      
      return Response.json({
        success: true,
        deleted_count: order_ids.length,
        affected_settlement_rows: 0,
        unmatched_after_delete: 0,
        matched_order_ids: [],
        unmatched_order_ids: unmatchedOrderIds,
        sample_settlement_order_ids: sampleOrderIds,
        message: 'No linked settlement rows found for provided order IDs',
        diagnostics: {
          input_order_ids: order_ids,
          normalized_order_ids: order_ids.map(normalizeOrderId),
          total_settlement_rows_in_workspace: allRows.length,
          sample_settlement_order_ids: Array.from(rowsByNormalizedOrderId.keys()).slice(0, 10)
        }
      });
    }

    return Response.json({
      success: true,
      deleted_count: order_ids.length,
      affected_settlement_rows: totalAffected,
      unmatched_after_delete: unmatchedAfterDelete,
      matched_order_ids: matchedOrderIds,
      unmatched_order_ids: unmatchedOrderIds,
      message: `Deleted ${matchedOrderIds.length} order${matchedOrderIds.length > 1 ? 's' : ''}, updated ${totalAffected} settlement row${totalAffected > 1 ? 's' : ''}, ${unmatchedAfterDelete} now unmatched`,
      diagnostics: {
        input_order_ids: order_ids,
        normalized_order_ids: order_ids.map(normalizeOrderId),
        matched_count: matchedOrderIds.length,
        unmatched_count: unmatchedOrderIds.length
      }
    });
  } catch (error) {
    console.error('[deleteSettlementOrders] Error:', error);
    return Response.json({ code: 'ERROR', message: error.message }, { status: 500 });
  }
});