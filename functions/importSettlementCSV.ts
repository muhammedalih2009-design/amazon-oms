import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { normalizeOrderId } from './helpers/normalizeOrderId.js';

Deno.serve(async (req) => {
  let importJobId;
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tenantId, csvData, filename } = await req.json();
    
    // TASK 1 FIX: Consistent variable naming and explicit access check
    if (!tenantId) {
      return Response.json({ error: 'tenantId required' }, { status: 400 });
    }

    // Verify workspace access with tenantId (not workspaceId)
    const membership = await base44.entities.Membership.filter({
      tenant_id: tenantId,
      user_email: user.email
    });

    if (membership.length === 0) {
      console.error(`❌ ACCESS DENIED: user=${user.email}, tenantId=${tenantId}, importJobId=pending`);
      return Response.json({ 
        error: 'Access denied - not a member of this workspace' 
      }, { status: 403 });
    }

    console.log(`✅ ACCESS GRANTED: user=${user.email}, tenantId=${tenantId}`);

    // Create import batch
    const batch = await base44.asServiceRole.entities.ImportBatch.create({
      tenant_id: tenantId,
      batch_type: 'settlements',
      filename: filename || 'settlement.csv',
      display_name: `Settlement Import ${new Date().toLocaleString()}`,
      status: 'processing',
      total_rows: 0,
      success_rows: 0,
      failed_rows: 0
    });

    importJobId = batch.id;
    console.log(`📊 IMPORT STARTED: tenantId=${tenantId}, userId=${user.id}, importJobId=${importJobId}`);

    // Parse CSV data
    const rows = csvData.split('\n').filter(r => r.trim());
    if (rows.length === 0) {
      throw new Error('Empty CSV file');
    }

    const headers = rows[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
    const dataRows = rows.slice(1);

    await base44.asServiceRole.entities.ImportBatch.update(batch.id, {
      total_rows: dataRows.length
    });

    // Get existing orders for matching
    const existingOrders = await base44.asServiceRole.entities.Order.filter({ 
      tenant_id: tenantId 
    });

    // TASK 5 FIX: Use normalized order ID for matching
    const orderMap = new Map();
    for (const order of existingOrders) {
      const normalized = normalizeOrderId(order.amazon_order_id);
      orderMap.set(normalized, order);
    }

    let successCount = 0;
    let failedCount = 0;
    const errors = [];

    for (let i = 0; i < dataRows.length; i++) {
      try {
        const values = dataRows[i].split(',').map(v => v.trim());
        const rowData = {};
        headers.forEach((h, idx) => {
          rowData[h] = values[idx] || '';
        });

        // Extract order ID and normalize
        const rawOrderId = rowData.order_id || rowData.amazon_order_id || '';
        if (!rawOrderId) {
          throw new Error('Missing order ID');
        }

        const normalizedOrderId = normalizeOrderId(rawOrderId);
        const matchedOrder = orderMap.get(normalizedOrderId);

        if (!matchedOrder) {
          throw new Error(`Order not found: ${rawOrderId}`);
        }

        // Extract settlement data
        const settlementDate = rowData.settlement_date || rowData.date || '';
        const netRevenue = parseFloat(rowData.net_revenue || rowData.revenue || '0') || 0;

        // Update order with settlement data
        await base44.asServiceRole.entities.Order.update(matchedOrder.id, {
          settlement_date: settlementDate,
          net_revenue: netRevenue,
          // Preserve existing COGS if set
          total_cost: matchedOrder.total_cost || 0,
          profit_loss: netRevenue - (matchedOrder.total_cost || 0),
          profit_margin_percent: netRevenue > 0 
            ? ((netRevenue - (matchedOrder.total_cost || 0)) / netRevenue) * 100 
            : 0
        });

        successCount++;
      } catch (error) {
        failedCount++;
        await base44.asServiceRole.entities.ImportError.create({
          tenant_id: tenantId,
          batch_id: batch.id,
          row_number: i + 1,
          raw_row_json: dataRows[i],
          error_reason: error.message
        });
        errors.push({ row: i + 1, error: error.message });
      }
    }

    // Update batch status
    await base44.asServiceRole.entities.ImportBatch.update(batch.id, {
      status: failedCount === 0 ? 'success' : (successCount > 0 ? 'partial' : 'failed'),
      success_rows: successCount,
      failed_rows: failedCount
    });

    console.log(`✅ IMPORT COMPLETE: importJobId=${importJobId}, success=${successCount}, failed=${failedCount}`);

    return Response.json({
      success: true,
      batchId: batch.id,
      stats: {
        total: dataRows.length,
        success: successCount,
        failed: failedCount
      },
      errors: errors.slice(0, 10) // Return first 10 errors
    });

  } catch (error) {
    console.error(`❌ IMPORT FAILED: tenantId=${tenantId}, importJobId=${importJobId}`, error);
    
    if (importJobId) {
      try {
        await base44.asServiceRole.entities.ImportBatch.update(importJobId, {
          status: 'failed',
          error_message: error.message
        });
      } catch (updateError) {
        console.error('Failed to update import batch status:', updateError);
      }
    }

    return Response.json({ 
      error: error.message,
      details: error.stack 
    }, { status: 500 });
  }
});