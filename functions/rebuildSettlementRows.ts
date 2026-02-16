import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { workspace_id, import_id } = body;

    if (!workspace_id || !import_id) {
      return Response.json({ error: 'Missing workspace_id or import_id' }, { status: 400 });
    }

    // Verify access
    const membership = await base44.asServiceRole.entities.Membership.filter({
      tenant_id: workspace_id,
      user_id: user.id
    });

    if (membership.length === 0) {
      return Response.json({ error: 'No access to workspace' }, { status: 403 });
    }

    // Get the import
    const importJob = await base44.asServiceRole.entities.SettlementImport.get(import_id);
    if (!importJob || importJob.tenant_id !== workspace_id) {
      return Response.json({ error: 'Import not found' }, { status: 404 });
    }

    // Get existing rows
    const existingRows = await base44.asServiceRole.entities.SettlementRow.filter({
      settlement_import_id: import_id
    });

    const existingRowIndices = new Set(existingRows.map(r => r.row_index));
    console.log(`[rebuildSettlementRows] Found ${existingRows.length} existing rows`);
    
    // Parse target rows
    const parsedRows = JSON.parse(importJob.parsed_rows_json || '[]');
    console.log(`[rebuildSettlementRows] Target: ${parsedRows.length} rows from parsed_rows_json`);

    // Create only missing rows (idempotent)
    let totalCreated = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    const failedRows = [];

    for (let i = 0; i < parsedRows.length; i++) {
      const row = parsedRows[i];
      const rowIndex = i;

      if (existingRowIndices.has(rowIndex)) {
        totalSkipped++;
        continue;
      }

      try {
        await base44.asServiceRole.entities.SettlementRow.create({
          ...row,
          settlement_import_id: import_id,
          row_index: rowIndex
        });
        totalCreated++;
      } catch (err) {
        totalFailed++;
        failedRows.push({ row_index: rowIndex, error: err.message });
        console.error(`[rebuildSettlementRows] Failed row ${rowIndex}:`, err);
      }

      if ((totalCreated + totalSkipped + totalFailed) % 100 === 0) {
        console.log(`[rebuildSettlementRows] Progress: created=${totalCreated}, skipped=${totalSkipped}, failed=${totalFailed}`);
      }
    }

    // Match with orders and SKUs using canonical normalization
    const [orders, skus] = await Promise.all([
      base44.asServiceRole.entities.Order.filter({ tenant_id: workspace_id, is_deleted: false }),
      base44.asServiceRole.entities.SKU.filter({ tenant_id: workspace_id })
    ]);

    console.log(`[rebuildSettlementRows] Matching against ${orders.length} orders and ${skus.length} SKUs`);

    // Canonical normalization
    const normalizeOrderId = (orderId) => {
      if (!orderId) return '';
      return orderId.toString().trim().toUpperCase()
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\s+/g, '')
        .replace(/-/g, '');
    };

    // Re-fetch created rows to get their IDs
    const createdRows = await base44.asServiceRole.entities.SettlementRow.filter({
      settlement_import_id: import_id
    });

    let matchedCount = 0;
    const updates = [];

    for (const row of createdRows) {
      let matchStatus = 'unmatched_order';
      let matchedOrderId = null;
      let matchedSkuId = null;

      const normalizedRowOrderId = normalizeOrderId(row.order_id);
      
      // Try normalized matching
      const matchedOrder = orders.find(o => 
        normalizeOrderId(o.amazon_order_id) === normalizedRowOrderId ||
        normalizeOrderId(o.id) === normalizedRowOrderId
      );

      if (matchedOrder) {
        matchedOrderId = matchedOrder.id;
        
        // Try to match SKU
        const matchedSku = skus.find(s => 
          s.sku_code === row.sku ||
          normalizeOrderId(s.sku_code) === normalizeOrderId(row.sku)
        );
        
        if (matchedSku) {
          matchedSkuId = matchedSku.id;
          matchStatus = 'matched';
          matchedCount++;
        } else {
          matchStatus = 'unmatched_sku';
        }
      }

      updates.push({
        id: row.id,
        data: {
          matched_order_id: matchedOrderId,
          matched_sku_id: matchedSkuId,
          match_status: matchStatus
        }
      });
    }

    // Apply updates in batches
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(item => 
          base44.asServiceRole.entities.SettlementRow.update(item.id, item.data)
        )
      );
      console.log(`[rebuildSettlementRows] Updated ${Math.min(i + BATCH_SIZE, updates.length)}/${updates.length}`);
    }

    // Update import job with final counts
    const finalRowCount = existingRows.length + totalCreated;
    await base44.asServiceRole.entities.SettlementImport.update(import_id, {
      rows_count: finalRowCount,
      matched_rows_count: matchedCount,
      unmatched_rows_count: finalRowCount - matchedCount
    });

    return Response.json({
      success: true,
      rows_expected: parsedRows.length,
      rows_existing_before: existingRows.length,
      rows_created: totalCreated,
      rows_skipped: totalSkipped,
      rows_failed: totalFailed,
      failed_rows: failedRows.slice(0, 10),
      rows_matched: matchedCount,
      rows_unmatched: finalRowCount - matchedCount
    });
  } catch (error) {
    console.error('[rebuildSettlementRows] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});