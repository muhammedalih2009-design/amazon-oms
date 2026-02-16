import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const reqBody = await req.json();
    const { workspace_id } = reqBody;

    if (!workspace_id) {
      return Response.json({ error: 'workspace_id required' }, { status: 400 });
    }

    console.log(`[DIAGNOSTIC] Starting integrity check for workspace: ${workspace_id}`);

    // STEP 1: Count orders, settlement rows, and matched rows
    const [activeOrders, allSettlementRows] = await Promise.all([
      base44.asServiceRole.entities.Order.filter({ tenant_id: workspace_id, is_deleted: false }),
      base44.asServiceRole.entities.SettlementRow.filter({ tenant_id: workspace_id, is_deleted: false })
    ]);

    const matchedRows = allSettlementRows.filter(r => r.matched_order_id && (r.match_status === 'matched' || r.match_status === 'unmatched_sku'));

    console.log(`[STEP 1] Active orders: ${activeOrders.length} | All settlement rows: ${allSettlementRows.length} | Matched rows: ${matchedRows.length}`);

    // STEP 2: Sample 10 matched rows and validate their matched_order_id pointers
    const sampleSize = Math.min(10, matchedRows.length);
    const sampleRows = matchedRows.slice(0, sampleSize);
    
    const pointerValidation = [];
    let integrityIssues = [];

    for (const row of sampleRows) {
      let orderFound = false;
      let orderData = null;
      let isDeleted = null;
      let tenantMatch = false;

      try {
        // Direct lookup by matched_order_id
        orderData = await base44.asServiceRole.entities.Order.get(row.matched_order_id);
        orderFound = !!orderData;
        if (orderData) {
          isDeleted = orderData.is_deleted || false;
          tenantMatch = orderData.tenant_id === workspace_id;
        }
      } catch (error) {
        orderFound = false;
        console.log(`[LOOKUP] Order.get(${row.matched_order_id}) failed:`, error.message);
      }

      const validation = {
        settlement_row_id: row.id,
        order_id: row.order_id,
        matched_order_id: row.matched_order_id,
        row_tenant_id: row.tenant_id,
        order_found_by_get: orderFound,
        order_tenant_id: orderData?.tenant_id || 'N/A',
        order_is_deleted: isDeleted,
        tenant_match: tenantMatch,
        order_total_cost: orderData?.total_cost || 0
      };

      pointerValidation.push(validation);

      // STEP 3: Check for integrity issues
      if (!orderFound) {
        integrityIssues.push({
          row_id: row.id,
          error_code: 'MATCH_POINTER_NOT_FOUND',
          matched_order_id: row.matched_order_id
        });
      } else if (isDeleted) {
        integrityIssues.push({
          row_id: row.id,
          error_code: 'MATCHED_ORDER_IS_DELETED',
          matched_order_id: row.matched_order_id
        });
      } else if (!tenantMatch) {
        integrityIssues.push({
          row_id: row.id,
          error_code: 'TENANT_MISMATCH',
          matched_order_id: row.matched_order_id,
          expected_tenant: workspace_id,
          actual_tenant: orderData?.tenant_id
        });
      }
    }

    console.log(`[STEP 2-3] Pointer validation issues: ${integrityIssues.length}`);

    // STEP 4: Check the specific debug orders
    const debugOrderIds = ['406-9098319-4354700', '405-9237140-1177144', '407-7729567-8966740', '171-1927461-9022731'];
    const debugProofTable = [];

    for (const amazonOrderId of debugOrderIds) {
      const settlementRowsForOrder = allSettlementRows.filter(r => r.order_id === amazonOrderId);
      
      for (const row of settlementRowsForOrder) {
        let matchedOrder = null;
        let orderFound = false;
        let reason = 'UNKNOWN';

        if (row.matched_order_id) {
          try {
            matchedOrder = await base44.asServiceRole.entities.Order.get(row.matched_order_id);
            orderFound = !!matchedOrder && !matchedOrder.is_deleted;
            if (!orderFound && matchedOrder?.is_deleted) {
              reason = 'ORDER_DELETED';
            } else if (orderFound) {
              reason = 'ORDER_FOUND';
            } else {
              reason = 'LOOKUP_FAILED';
            }
          } catch (error) {
            reason = `LOOKUP_ERROR: ${error.message}`;
            orderFound = false;
          }
        } else {
          reason = 'NO_MATCHED_ORDER_ID';
        }

        debugProofTable.push({
          settlement_row_id: row.id,
          order_id: amazonOrderId,
          matched_order_id: row.matched_order_id || 'NULL',
          order_found_by_get: orderFound,
          order_tenant_id: matchedOrder?.tenant_id || 'N/A',
          order_is_deleted: matchedOrder?.is_deleted || 'N/A',
          total_cost: matchedOrder?.total_cost || 0,
          match_status: row.match_status,
          reason
        });
      }
    }

    console.log(`[STEP 4] Debug order proof table entries: ${debugProofTable.length}`);

    // STEP 5: Check for INTEGRITY_BROKEN condition
    const integrityBroken = integrityIssues.length > 0;

    return Response.json({
      success: !integrityBroken,
      diagnostics: {
        workspace_id,
        counts: {
          active_orders: activeOrders.length,
          total_settlement_rows: allSettlementRows.length,
          matched_settlement_rows: matchedRows.length
        },
        pointer_validation: {
          sample_size: sampleSize,
          issues_found: integrityIssues.length,
          samples: pointerValidation,
          issues: integrityIssues
        },
        integrity_status: integrityBroken ? 'MATCH_POINTER_INTEGRITY_BROKEN' : 'VALID',
        debug_proof_table: debugProofTable,
        summary: {
          all_samples_found: integrityIssues.length === 0,
          total_issues: integrityIssues.length,
          reason: integrityBroken ? `${integrityIssues.length} pointer integrity issues detected` : 'No issues detected'
        }
      }
    });

  } catch (error) {
    console.error('[diagnosticSettlementIntegrity] ERROR:', error);
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});