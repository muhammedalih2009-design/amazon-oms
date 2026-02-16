import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * PROOF: Demonstrate that SettlementRow is the authoritative source
 * and provide sample COGS before/after for matched orders.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const reqBody = await req.json();
    const { workspace_id, import_id, limit = 5 } = reqBody;

    if (!workspace_id) {
      return Response.json({ error: 'workspace_id required' }, { status: 400 });
    }

    console.log(`[PROOF] Starting for workspace: ${workspace_id}`);

    // Load SettlementRow matches (authoritative)
    const rowQuery = { tenant_id: workspace_id, is_deleted: false };
    if (import_id) {
      rowQuery.settlement_import_id = import_id;
    }

    const allRows = await base44.asServiceRole.entities.SettlementRow.filter(rowQuery);
    const matchedRows = allRows.filter(r => 
      r.matched_order_id && (r.match_status === 'matched' || r.match_status === 'unmatched_sku')
    );

    // Load SettlementMatch (deprecated, for comparison only)
    const settlementMatches = await base44.asServiceRole.entities.SettlementMatch.filter({
      tenant_id: workspace_id
    });

    console.log(`[PROOF] SettlementRow matched: ${matchedRows.length} | SettlementMatch: ${settlementMatches.length}`);

    // Sample matched rows for COGS proof
    const sampleRows = matchedRows.slice(0, limit);
    const proof = [];

    for (const row of sampleRows) {
      let order;
      try {
        order = await base44.asServiceRole.entities.Order.get(row.matched_order_id);
      } catch (err) {
        console.log(`[PROOF] Failed to fetch Order ${row.matched_order_id}`);
        continue;
      }

      if (!order || order.is_deleted) {
        console.log(`[PROOF] Skipped deleted order ${row.matched_order_id}`);
        continue;
      }

      // Check cost fields
      const orderCostFields = {
        cost: order.cost || 0,
        total_cost: order.total_cost || 0,
        cogs: order.cogs || 0,
        order_cost: order.order_cost || 0
      };

      const hasCost = Object.values(orderCostFields).some(v => v > 0);

      proof.push({
        settlement_order_id: row.order_id,
        matched_order_id: order.id,
        amazon_order_id: order.amazon_order_id,
        source: 'SettlementRow.matched_order_id',
        order_cost_fields: orderCostFields,
        has_cost_data: hasCost,
        net_revenue: order.net_revenue || 0,
        total_cost_field: order.total_cost || 0,
        profit_potential: (order.net_revenue || 0) - (order.total_cost || 0)
      });
    }

    // Summary
    const proofWithCost = proof.filter(p => p.has_cost_data).length;
    const proofMissingCost = proof.filter(p => !p.has_cost_data).length;

    return Response.json({
      success: true,
      workspace_id,
      authoritative_source: 'SettlementRow.matched_order_id',
      deprecated_source: 'SettlementMatch (empty, non-authoritative)',
      counts: {
        total_settlement_rows: allRows.length,
        matched_rows_per_authority: matchedRows.length,
        settlement_match_records: settlementMatches.length,
        source_consistency: settlementMatches.length === 0 
          ? 'CONSISTENT (SettlementMatch unused, as designed)' 
          : 'SPLIT_BRAIN (both sources have data - requires reconciliation)'
      },
      sample_proof: {
        sample_size: proof.length,
        with_cost_data: proofWithCost,
        missing_cost_data: proofMissingCost,
        orders: proof
      },
      recommendation: proofMissingCost > 0
        ? `Run recomputeSettlementCOGS: ${proofMissingCost} orders missing cost data (can compute from OrderLines)`
        : `All sampled orders have cost data - COGS recompute ready`,
      remediation_steps: [
        '1. Verify Order records are imported',
        '2. Run recomputeSettlementCOGS (reads SettlementRow.matched_order_id)',
        '3. Optional: backfillSettlementMatchFromRows (audit trail only)',
        '4. Verify Settlement Orders tab shows correct COGS'
      ]
    });
  } catch (error) {
    console.error('[proveSourceOfTruth] ERROR:', error);
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});