import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const formData = await req.formData();
    const csvFile = formData.get('csvFile');
    const tenantId = formData.get('tenantId');

    if (!csvFile || !tenantId) {
      return Response.json({ error: 'Missing csvFile or tenantId' }, { status: 400 });
    }

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Create import job
    const importJob = await base44.asServiceRole.entities.SettlementImport.create({
      tenant_id: tenantId,
      file_name: csvFile.name,
      uploaded_by_user_id: user.id,
      status: 'processing',
      import_started_at: new Date().toISOString()
    });

    // Read CSV file
    const csvText = await csvFile.text();
    const cleanText = csvText.replace(/^\uFEFF/, ''); // Remove BOM if present

    // Split by newline and find header row
    const lines = cleanText.split(/\r\n|\n/).map(l => l.trim()).filter(l => l.length > 0);
    let headerLineIdx = -1;
    let headerLine = '';

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes('date/time') || lines[i].toLowerCase().includes('datetime')) {
        headerLineIdx = i;
        headerLine = lines[i];
        break;
      }
    }

    if (headerLineIdx === -1) {
      throw new Error('Could not find header row with "date/time" or "datetime"');
    }

    // Parse CSV header (handle quoted fields)
    const headers = parseCSVLine(headerLine);
    const headerMap = {};
    headers.forEach((h, idx) => {
      headerMap[h.toLowerCase().replace(/["\s]/g, '')] = idx;
    });

    // Require columns
    const requiredCols = ['datetime', 'settlementid', 'type', 'orderid', 'sku', 'quantity', 'total'];
    for (const col of requiredCols) {
      if (!Object.keys(headerMap).some(h => h.includes(col))) {
        throw new Error(`Missing required column: ${col}`);
      }
    }

    // Parse data rows
    const dataRows = lines.slice(headerLineIdx + 1);
    const settlementRows = [];
    const monthDates = [];

    for (const line of dataRows) {
      if (!line.trim()) continue;

      const fields = parseCSVLine(line);
      const row = {};
      headers.forEach((h, idx) => {
        row[h.toLowerCase().replace(/["\s]/g, '')] = fields[idx] || '';
      });

      try {
        // Parse datetime
        const datetimeStr = row.datetime || row.datetimevalue || '';
        const datetime = new Date(datetimeStr);
        if (isNaN(datetime.getTime())) {
          console.warn(`Skipping row with invalid datetime: ${datetimeStr}`);
          continue;
        }
        monthDates.push(datetime);

        // Parse numeric fields
        const quantity = Math.abs(parseFloat(row.quantity || '0') || 0);
        const total = parseFloat(row.total || '0') || 0;

        // Determine sign
        const typeStr = (row.type || '').toLowerCase();
        const isRefund = typeStr.includes('refund') || total < 0;
        const sign = isRefund ? -1 : 1;
        const signedQty = quantity * sign;

        const settlementRow = {
          tenant_id: tenantId,
          settlement_import_id: importJob.id,
          datetime: datetime.toISOString(),
          settlement_id: row.settlementid || '',
          type: row.type || '',
          order_id: row.orderid || '',
          sku: row.sku || '',
          description: row.description || '',
          quantity: quantity,
          signed_qty: signedQty,
          marketplace: row.marketplace || '',
          fulfillment: row.fulfillment || '',
          order_city: row.ordercity || '',
          order_state: row.orderstate || '',
          order_postal: row.orderpostal || '',
          product_sales: parseFloat(row.productsales || '0') || 0,
          shipping_credits: parseFloat(row.shippingcredits || '0') || 0,
          promotional_rebates: parseFloat(row.promotionalrebates || '0') || 0,
          selling_fees: parseFloat(row.sellingfees || '0') || 0,
          fba_fees: parseFloat(row.fbafees || '0') || 0,
          other_transaction_fees: parseFloat(row.othertransactionfees || '0') || 0,
          other: parseFloat(row.other || '0') || 0,
          total: total,
          is_refund_like: isRefund,
          match_status: 'unmatched_order'
        };

        settlementRows.push(settlementRow);
      } catch (err) {
        console.warn(`Error parsing row:`, err.message);
      }
    }

    if (settlementRows.length === 0) {
      throw new Error('No valid data rows found in CSV');
    }

    // Bulk insert rows
    await base44.asServiceRole.entities.SettlementRow.bulkCreate(settlementRows);

    // Fetch OMS data for matching
    const [orders, skus] = await Promise.all([
      base44.asServiceRole.entities.Order.filter({ tenant_id: tenantId }),
      base44.asServiceRole.entities.SKU.filter({ tenant_id: tenantId })
    ]);

    // Match rows
    let matchedCount = 0;
    let unmatchedCount = 0;

    for (const row of settlementRows) {
      let matchStatus = 'unmatched_order';
      let matchedOrderId = null;
      let matchedSkuId = null;

      // Try to find order
      const matchedOrder = orders.find(o => o.amazon_order_id === row.order_id || o.id === row.order_id);
      if (matchedOrder) {
        matchedOrderId = matchedOrder.id;
        
        // Try to find SKU
        const matchedSku = skus.find(s => s.sku_code === row.sku);
        if (matchedSku) {
          matchedSkuId = matchedSku.id;
          matchStatus = 'matched';
          matchedCount++;
        } else {
          matchStatus = 'unmatched_sku';
          unmatchedCount++;
        }
      } else {
        unmatchedCount++;
      }

      // Update settlement row with match info
      const settlementRowId = settlementRows.indexOf(row) >= 0 ? 
        (await base44.asServiceRole.entities.SettlementRow.filter({
          settlement_import_id: importJob.id,
          order_id: row.order_id,
          sku: row.sku
        }))[0]?.id : null;

      if (settlementRowId) {
        await base44.asServiceRole.entities.SettlementRow.update(settlementRowId, {
          matched_order_id: matchedOrderId,
          matched_sku_id: matchedSkuId,
          match_status: matchStatus
        });
      }
    }

    // Compute aggregates
    const totalRevenue = settlementRows.reduce((sum, r) => sum + r.total, 0);
    const matchedRows = settlementRows.filter(r => r.match_status === 'matched');
    
    let totalCogs = 0;
    for (const row of matchedRows) {
      const sku = skus.find(s => s.id === row.matched_sku_id);
      if (sku && sku.cost_price) {
        totalCogs += sku.cost_price * row.signed_qty;
      }
    }

    const monthKey = monthDates.length > 0 
      ? monthDates[0].toISOString().substring(0, 7)
      : new Date().toISOString().substring(0, 7);

    // Update import job
    await base44.asServiceRole.entities.SettlementImport.update(importJob.id, {
      status: 'completed',
      month_key: monthKey,
      rows_count: settlementRows.length,
      matched_rows_count: matchedCount,
      unmatched_rows_count: unmatchedCount,
      totals_cached_json: {
        total_revenue: totalRevenue,
        total_cogs: totalCogs,
        total_profit: totalRevenue - totalCogs,
        margin: totalRevenue !== 0 ? ((totalRevenue - totalCogs) / totalRevenue) : 0,
        orders_count: new Set(settlementRows.map(r => r.order_id)).size,
        skus_count: new Set(settlementRows.map(r => r.sku)).size
      },
      import_completed_at: new Date().toISOString()
    });

    return Response.json({
      success: true,
      importId: importJob.id,
      rowsCount: settlementRows.length,
      matchedCount,
      unmatchedCount,
      totals: {
        total_revenue: totalRevenue,
        total_cogs: totalCogs,
        total_profit: totalRevenue - totalCogs,
        margin: totalRevenue !== 0 ? ((totalRevenue - totalCogs) / totalRevenue) : 0
      }
    });
  } catch (error) {
    console.error('Settlement import error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// Helper: Parse CSV line respecting quoted fields
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current.trim().replace(/^"|"$/g, ''));
  return fields;
}