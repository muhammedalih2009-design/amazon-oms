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

    // Delete existing rows for this import
    const existingRows = await base44.asServiceRole.entities.SettlementRow.filter({
      settlement_import_id: import_id
    });

    console.log(`[rebuildSettlementRows] Deleting ${existingRows.length} existing rows`);
    
    for (const row of existingRows) {
      await base44.asServiceRole.entities.SettlementRow.delete(row.id);
    }

    // Parse and recreate rows
    const parsedRows = JSON.parse(importJob.parsed_rows_json || '[]');
    console.log(`[rebuildSettlementRows] Recreating ${parsedRows.length} rows`);

    const rowsToCreate = parsedRows.map(row => ({
      ...row,
      settlement_import_id: import_id
    }));

    // Insert in batches
    const BATCH_SIZE = 100;
    let totalCreated = 0;

    for (let i = 0; i < rowsToCreate.length; i += BATCH_SIZE) {
      const batch = rowsToCreate.slice(i, i + BATCH_SIZE);
      await base44.asServiceRole.entities.SettlementRow.bulkCreate(batch);
      totalCreated += batch.length;
      console.log(`[rebuildSettlementRows] Created ${totalCreated}/${rowsToCreate.length}`);
    }

    // Match with orders and SKUs
    const [orders, skus] = await Promise.all([
      base44.asServiceRole.entities.Order.filter({ tenant_id: workspace_id }),
      base44.asServiceRole.entities.SKU.filter({ tenant_id: workspace_id })
    ]);

    console.log(`[rebuildSettlementRows] Matching against ${orders.length} orders and ${skus.length} SKUs`);

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

      const matchedOrder = orders.find(o => 
        o.amazon_order_id === row.order_id || o.id === row.order_id
      );

      if (matchedOrder) {
        matchedOrderId = matchedOrder.id;
        const matchedSku = skus.find(s => s.sku_code === row.sku);
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

    return Response.json({
      success: true,
      rows_created: totalCreated,
      rows_matched: matchedCount,
      rows_unmatched: totalCreated - matchedCount
    });
  } catch (error) {
    console.error('[rebuildSettlementRows] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});