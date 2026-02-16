import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * BACKFILL: Populate SettlementMatch table from authoritative SettlementRow data
 * 
 * This is OPTIONAL and for AUDIT TRAIL ONLY.
 * SettlementRow remains the source-of-truth.
 * 
 * Idempotent: Will not create duplicates if called multiple times.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const reqBody = await req.json();
    const { workspace_id, import_id } = reqBody;

    if (!workspace_id) {
      return Response.json({ error: 'workspace_id required' }, { status: 400 });
    }

    console.log(`[BACKFILL] Starting for workspace: ${workspace_id}${import_id ? `, import: ${import_id}` : ''}`);

    // Load authoritative settlement rows
    const rowQuery = { tenant_id: workspace_id, is_deleted: false };
    if (import_id) {
      rowQuery.settlement_import_id = import_id;
    }

    const authoritativeRows = await base44.asServiceRole.entities.SettlementRow.filter(rowQuery);
    console.log(`[BACKFILL] Loaded ${authoritativeRows.length} settlement rows (authority)`);

    // Filter for matched rows
    const matchedRows = authoritativeRows.filter(r => 
      r.matched_order_id && (r.match_status === 'matched' || r.match_status === 'unmatched_sku')
    );
    console.log(`[BACKFILL] Found ${matchedRows.length} matched rows to backfill`);

    if (matchedRows.length === 0) {
      console.log(`[BACKFILL] No matched rows found, backfill skipped`);
      return Response.json({
        success: true,
        message: 'No matched rows to backfill',
        rows_processed: 0,
        records_created: 0,
        duplicates_skipped: 0
      });
    }

    // Load existing SettlementMatch records (to avoid duplicates)
    const existingMatches = await base44.asServiceRole.entities.SettlementMatch.filter({
      tenant_id: workspace_id
    });
    const existingMatchesByRowId = new Set(existingMatches.map(m => m.settlement_row_id));

    console.log(`[BACKFILL] Existing SettlementMatch records: ${existingMatches.length}`);

    // Create SettlementMatch records for unmatched rows (idempotent)
    const recordsToCreate = [];
    const duplicatesSkipped = [];

    for (const row of matchedRows) {
      if (existingMatchesByRowId.has(row.id)) {
        duplicatesSkipped.push(row.id);
        console.log(`[BACKFILL] Skipping duplicate: row ${row.id}`);
      } else {
        recordsToCreate.push({
          tenant_id: workspace_id,
          settlement_row_id: row.id,
          matched_order_id: row.matched_order_id,
          matched_sku_id: row.matched_sku_id || null,
          match_status: row.match_status || 'matched',
          match_note: `Backfilled from SettlementRow.matched_order_id (authoritative source)`
        });
      }
    }

    console.log(`[BACKFILL] Creating ${recordsToCreate.length} records, skipping ${duplicatesSkipped.length} duplicates`);

    // Bulk create in batches
    let created = 0;
    const BATCH_SIZE = 100;
    for (let i = 0; i < recordsToCreate.length; i += BATCH_SIZE) {
      const batch = recordsToCreate.slice(i, i + BATCH_SIZE);
      await base44.asServiceRole.entities.SettlementMatch.bulkCreate(batch);
      created += batch.length;
      console.log(`[BACKFILL] Batch created: ${created}/${recordsToCreate.length}`);
    }

    console.log(`[BACKFILL] Complete: ${created} records created, ${duplicatesSkipped.length} duplicates skipped`);

    return Response.json({
      success: true,
      message: 'Backfill completed (non-authoritative audit trail only)',
      authority: 'SettlementRow.matched_order_id',
      rows_processed: matchedRows.length,
      records_created: created,
      duplicates_skipped: duplicatesSkipped.length,
      new_total_match_records: existingMatches.length + created,
      note: 'SettlementMatch table is now in sync with SettlementRow (for audit only)'
    });
  } catch (error) {
    console.error('[backfillSettlementMatchFromRows] ERROR:', error);
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});