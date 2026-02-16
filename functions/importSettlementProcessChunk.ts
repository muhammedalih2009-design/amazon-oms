import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { normalizeOrderId } from './helpers/normalizeOrderId.js';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const importId = body.import_id;

    if (!importId) {
      return Response.json({
        code: 'VALIDATION_ERROR',
        message: 'Missing import_id',
        details: []
      }, { status: 400 });
    }

    // Authenticate
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({
        code: 'UNAUTHORIZED',
        message: 'Not authenticated',
        details: []
      }, { status: 401 });
    }

    // Load import job
    const importJob = await base44.asServiceRole.entities.SettlementImport.get(importId);
    if (!importJob) {
      return Response.json({
        code: 'NOT_FOUND',
        message: 'Import job not found',
        details: []
      }, { status: 404 });
    }

    // If already done or failed, return status
    if (importJob.status === 'completed' || importJob.status === 'completed_with_errors') {
      return Response.json({
        ok: true,
        status: importJob.status,
        processed_rows: importJob.processed_rows,
        total_rows: importJob.total_rows,
        cursor: importJob.cursor,
        rows_count: importJob.rows_count
      });
    }

    if (importJob.status === 'failed') {
      return Response.json({
        ok: true,
        status: 'failed',
        error: importJob.error_message,
        processed_rows: importJob.processed_rows,
        total_rows: importJob.total_rows
      });
    }

    // Parse stored data
    let parsedRows = [];
    try {
      parsedRows = JSON.parse(importJob.parsed_rows_json || '[]');
    } catch (err) {
      return Response.json({
        code: 'PARSE_ERROR',
        message: 'Failed to load parsed rows',
        details: [err.message]
      }, { status: 500 });
    }

    if (parsedRows.length === 0) {
      return Response.json({
        code: 'PARSE_ERROR',
        message: 'No parsed rows found',
        details: []
      }, { status: 500 });
    }

    // Determine chunk bounds
    const start = importJob.cursor;
    const chunkSize = importJob.chunk_size || 400;
    const end = Math.min(start + chunkSize, parsedRows.length);
    const chunkIndex = Math.floor(start / chunkSize);

    // Create chunk record
    const chunk = await base44.asServiceRole.entities.SettlementImportChunk.create({
      tenant_id: importJob.tenant_id,
      settlement_import_id: importId,
      chunk_index: chunkIndex,
      start_row: start,
      end_row: end,
      rows_count: end - start,
      status: 'processing'
    });

    // Extract and insert chunk rows
    const chunkRows = parsedRows.slice(start, end);
    const chunkRowsWithMeta = chunkRows.map((row, idx) => ({
      ...row,
      settlement_import_id: importId,
      row_index: start + idx,
      raw_order_id: row.order_id,
      normalized_order_id: normalizeOrderId(row.order_id)
    }));

    let insertedRows = [];
    let rowsCreated = 0;
    let rowsSkipped = 0;
    
    // Insert rows individually for idempotency checking
    for (const row of chunkRowsWithMeta) {
      try {
        // Check if row already exists (idempotency)
        const existing = await base44.asServiceRole.entities.SettlementRow.filter({
          settlement_import_id: importId,
          row_index: row.row_index
        });

        if (existing.length > 0) {
          insertedRows.push(existing[0]);
          rowsSkipped++;
          continue;
        }

        const created = await base44.asServiceRole.entities.SettlementRow.create(row);
        insertedRows.push(created);
        rowsCreated++;
      } catch (err) {
        console.error(`[importSettlementProcessChunk] Failed to insert row ${row.row_index}:`, err);
        await base44.asServiceRole.entities.SettlementImportChunk.update(chunk.id, {
          status: 'failed',
          error: `Row ${row.row_index}: ${err.message}`,
          attempts: 1
        });

        return Response.json({
          code: 'INSERT_ERROR',
          message: `Failed to insert row ${row.row_index}`,
          details: [err.message]
        }, { status: 500 });
      }
    }
    
    console.log(`[importSettlementProcessChunk] Chunk ${chunkIndex}: created=${rowsCreated}, skipped=${rowsSkipped}`);

    // Match rows and update - use canonical normalization
    const [orders, skus, orderLines] = await Promise.all([
      base44.asServiceRole.entities.Order.filter({ tenant_id: importJob.tenant_id, is_deleted: false }),
      base44.asServiceRole.entities.SKU.filter({ tenant_id: importJob.tenant_id }),
      base44.asServiceRole.entities.OrderLine.filter({ tenant_id: importJob.tenant_id })
    ]);

    let matchedInChunk = 0;
    const updateBatch = [];

    for (let i = 0; i < chunkRowsWithMeta.length; i++) {
      const row = chunkRowsWithMeta[i];
      const insertedRow = insertedRows[i];

      let matchStatus = 'unmatched_order';
      let matchedOrderId = null;
      let matchedSkuId = null;
      let matchStrategy = null;
      let notFoundReason = 'Order not found after normalization';

      const normalizedRowOrderId = normalizeOrderId(row.order_id);
      
      // Primary match against amazon_order_id using canonical normalization
      const matchedOrder = orders.find(o => normalizeOrderId(o.amazon_order_id) === normalizedRowOrderId);

      if (matchedOrder) {
        matchedOrderId = matchedOrder.id;
        matchStrategy = 'normalized_amazon_id';
        
        const matchedSku = skus.find(s => 
          s.sku_code === row.sku ||
          normalizeOrderId(s.sku_code) === normalizeOrderId(row.sku)
        );
        
        if (matchedSku) {
          matchedSkuId = matchedSku.id;
          matchStatus = 'matched';
          matchedInChunk++;
          notFoundReason = null;
          
          // Check COGS
          if (!matchedOrder.total_cost || matchedOrder.total_cost === 0) {
            const lines = orderLines.filter(l => l.order_id === matchedOrder.id);
            const computedCogs = lines.reduce((sum, l) => sum + ((l.unit_cost || 0) * (l.quantity || 0)), 0);
            
            if (computedCogs === 0) {
              notFoundReason = 'Order matched but COGS missing';
            }
          }
        } else {
          // Keep matched_order_id even if SKU missing
          matchStatus = 'unmatched_sku';
          notFoundReason = 'Order matched, SKU not found';
        }
      }

      if (insertedRow?.id) {
        updateBatch.push({
          id: insertedRow.id,
          data: {
            matched_order_id: matchedOrderId,
            matched_sku_id: matchedSkuId,
            match_status: matchStatus,
            match_strategy: matchStrategy,
            match_confidence: matchedOrderId ? 'high' : null,
            not_found_reason: notFoundReason
          }
        });
      }
    }

    // Batch updates with delays
    const BATCH_SIZE = 20;
    for (let i = 0; i < updateBatch.length; i += BATCH_SIZE) {
      const batch = updateBatch.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(item =>
          base44.asServiceRole.entities.SettlementRow.update(item.id, item.data)
        )
      );
      if (i + BATCH_SIZE < updateBatch.length) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }

    // Update chunk status
    await base44.asServiceRole.entities.SettlementImportChunk.update(chunk.id, {
      status: 'completed'
    });

    // Update import job
    const newProcessedRows = importJob.processed_rows + rowsCreated;
    const newCursor = end;
    const isDone = newCursor >= parsedRows.length;

    let newStatus = importJob.status;
    if (isDone) {
      // Verify SettlementRow count matches expected
      const actualRowCount = await base44.asServiceRole.entities.SettlementRow.filter({
        settlement_import_id: importId
      }).then(rows => rows.length);

      const expectedRows = parsedRows.length;
      
      console.log(`[importSettlementProcessChunk] Completion check: expected=${expectedRows}, actual=${actualRowCount}`);

      if (actualRowCount < expectedRows * 0.95) {
        // Missing >5% of rows - mark as failed
        newStatus = 'failed';
        await base44.asServiceRole.entities.SettlementImport.update(importId, {
          status: newStatus,
          error_message: `Integrity check failed: expected ${expectedRows} rows, found ${actualRowCount}`,
          processed_rows: newProcessedRows,
          cursor: newCursor,
          rows_count: actualRowCount,
          import_completed_at: new Date().toISOString()
        });
      } else {
        newStatus = importJob.total_parse_errors > 0 ? 'completed_with_errors' : 'completed';
        await base44.asServiceRole.entities.SettlementImport.update(importId, {
          status: newStatus,
          processed_rows: newProcessedRows,
          cursor: newCursor,
          rows_count: actualRowCount,
          import_completed_at: new Date().toISOString()
        });
      }
    } else {
      await base44.asServiceRole.entities.SettlementImport.update(importId, {
        status: newStatus,
        processed_rows: newProcessedRows,
        cursor: newCursor,
        rows_count: newProcessedRows
      });
    }

    return Response.json({
      ok: true,
      status: newStatus,
      processed_rows: newProcessedRows,
      total_rows: parsedRows.length,
      cursor: newCursor,
      chunk: {
        index: chunkIndex,
        start: start,
        end: end,
        inserted: chunkRowsWithMeta.length,
        matched: matchedInChunk
      }
    });
  } catch (error) {
    console.error('Settlement process chunk error:', error);
    return Response.json({
      code: 'PROCESS_ERROR',
      message: error.message,
      details: []
    }, { status: 500 });
  }
});