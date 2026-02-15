import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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
    const chunkRowsWithMeta = chunkRows.map(row => ({
      ...row,
      settlement_import_id: importId
    }));

    let insertedRows = [];
    try {
      insertedRows = await base44.asServiceRole.entities.SettlementRow.bulkCreate(chunkRowsWithMeta);
    } catch (err) {
      await base44.asServiceRole.entities.SettlementImportChunk.update(chunk.id, {
        status: 'failed',
        error: err.message,
        attempts: 1
      });

      return Response.json({
        code: 'INSERT_ERROR',
        message: 'Failed to insert chunk rows',
        details: [err.message]
      }, { status: 500 });
    }

    // Match rows and update in smaller batches
    const [orders, skus] = await Promise.all([
      base44.asServiceRole.entities.Order.filter({ tenant_id: importJob.tenant_id }),
      base44.asServiceRole.entities.SKU.filter({ tenant_id: importJob.tenant_id })
    ]);

    let matchedInChunk = 0;
    const updateBatch = [];

    for (let i = 0; i < chunkRowsWithMeta.length; i++) {
      const row = chunkRowsWithMeta[i];
      const insertedRow = insertedRows[i];

      let matchStatus = 'unmatched_order';
      let matchedOrderId = null;
      let matchedSkuId = null;

      const matchedOrder = orders.find(o => o.amazon_order_id === row.order_id || o.id === row.order_id);
      if (matchedOrder) {
        matchedOrderId = matchedOrder.id;
        const matchedSku = skus.find(s => s.sku_code === row.sku);
        if (matchedSku) {
          matchedSkuId = matchedSku.id;
          matchStatus = 'matched';
          matchedInChunk++;
        } else {
          matchStatus = 'unmatched_sku';
        }
      }

      if (insertedRow?.id) {
        updateBatch.push({
          id: insertedRow.id,
          data: {
            matched_order_id: matchedOrderId,
            matched_sku_id: matchedSkuId,
            match_status: matchStatus
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
    const newProcessedRows = importJob.processed_rows + chunkRowsWithMeta.length;
    const newCursor = end;
    const isDone = newCursor >= parsedRows.length;

    let newStatus = importJob.status;
    if (isDone) {
      newStatus = importJob.total_parse_errors > 0 ? 'completed_with_errors' : 'completed';
    }

    await base44.asServiceRole.entities.SettlementImport.update(importId, {
      status: newStatus,
      processed_rows: newProcessedRows,
      cursor: newCursor,
      rows_count: newProcessedRows,
      import_completed_at: isDone ? new Date().toISOString() : null
    });

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