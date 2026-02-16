import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * AUDIT: Check for split-brain between SettlementRow.matched_order_id and SettlementMatch table
 * 
 * SOURCE-OF-TRUTH DECLARATION:
 * SettlementRow fields (matched_order_id, match_status, match_strategy, not_found_reason) 
 * are the AUTHORITATIVE source for match state.
 * 
 * SettlementMatch table is deprecated/optional (for audit trail only, not decision-making).
 */

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

    console.log(`[CONSISTENCY CHECK] Starting for workspace: ${workspace_id}`);

    // Load all settlement rows and matches
    const [allRows, allMatches] = await Promise.all([
      base44.asServiceRole.entities.SettlementRow.filter({
        tenant_id: workspace_id,
        is_deleted: false
      }),
      base44.asServiceRole.entities.SettlementMatch.filter({
        tenant_id: workspace_id
      })
    ]);

    console.log(`[CONSISTENCY CHECK] SettlementRows: ${allRows.length} | SettlementMatch: ${allMatches.length}`);

    // Count matched vs unmatched in SettlementRow (authoritative)
    const matchedRowsCount = allRows.filter(r => r.matched_order_id && (r.match_status === 'matched' || r.match_status === 'unmatched_sku')).length;
    const unmatchedRowsCount = allRows.filter(r => !r.matched_order_id || (r.match_status === 'unmatched_order')).length;

    console.log(`[CONSISTENCY CHECK] Per SettlementRow: ${matchedRowsCount} matched | ${unmatchedRowsCount} unmatched`);

    // Identify mismatches
    const mismatches = [];
    const matchesByRowId = new Map(allMatches.map(m => [m.settlement_row_id, m]));

    // Check: Rows with matched_order_id but NO SettlementMatch
    for (const row of allRows.filter(r => r.matched_order_id)) {
      if (!matchesByRowId.has(row.id)) {
        mismatches.push({
          settlement_row_id: row.id,
          order_id: row.order_id,
          matched_order_id: row.matched_order_id,
          issue: 'ROW_HAS_MATCH_BUT_NO_MATCH_RECORD',
          settlement_row_state: {
            matched_order_id: row.matched_order_id,
            match_status: row.match_status,
            match_strategy: row.match_strategy
          },
          settlement_match_state: null
        });
      }
    }

    // Check: SettlementMatch records pointing to non-existent rows
    for (const match of allMatches) {
      const rowExists = allRows.find(r => r.id === match.settlement_row_id);
      if (!rowExists) {
        mismatches.push({
          settlement_row_id: match.settlement_row_id,
          matched_order_id: match.matched_order_id,
          issue: 'MATCH_RECORD_ORPHANED_ROW_NOT_FOUND',
          settlement_row_state: null,
          settlement_match_state: {
            matched_order_id: match.matched_order_id,
            match_status: match.match_status
          }
        });
      }
    }

    const consistency = {
      timestamp: new Date().toISOString(),
      workspace_id,
      source_of_truth: 'SettlementRow (matched_order_id, match_status, match_strategy)',
      authoritative_counts: {
        total_settlement_rows: allRows.length,
        matched_rows: matchedRowsCount,
        unmatched_rows: unmatchedRowsCount
      },
      settlement_match_table: {
        total_records: allMatches.length,
        status: allMatches.length === 0 ? 'EMPTY (non-authoritative)' : `${allMatches.length} records (non-authoritative)`
      },
      mismatch_summary: {
        total_mismatches: mismatches.length,
        rows_with_match_but_no_record: mismatches.filter(m => m.issue === 'ROW_HAS_MATCH_BUT_NO_MATCH_RECORD').length,
        orphaned_match_records: mismatches.filter(m => m.issue === 'MATCH_RECORD_ORPHANED_ROW_NOT_FOUND').length
      },
      sample_mismatches: mismatches.slice(0, 10),
      recommendation: mismatches.length > 0 
        ? 'Use recomputeSettlementCOGS (which reads SettlementRow directly) - SettlementMatch table is not authoritative'
        : 'Consistency check passed (no split-brain detected)'
    };

    console.log(`[CONSISTENCY CHECK] Result:`, {
      matched_rows: matchedRowsCount,
      unmatched_rows: unmatchedRowsCount,
      mismatches: mismatches.length,
      settlement_match_records: allMatches.length
    });

    return Response.json(consistency);
  } catch (error) {
    console.error('[checkMatchSourceConsistency] ERROR:', error);
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});