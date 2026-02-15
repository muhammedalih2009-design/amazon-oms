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

    // Split by newline (keep non-empty)
    const lines = cleanText.split(/\r\n|\n/);
    
    // Find header row - first line containing key settlement columns
    let headerLineIdx = -1;
    let headerLine = '';
    const requiredHeaderKeywords = ['date/time', 'order', 'sku', 'total'];

    for (let i = 0; i < lines.length; i++) {
      const lowerLine = lines[i].toLowerCase();
      const hasRequiredKeywords = requiredHeaderKeywords.some(kw => lowerLine.includes(kw));
      
      if (hasRequiredKeywords && (lowerLine.includes('date') || lowerLine.includes('time'))) {
        headerLineIdx = i;
        headerLine = lines[i];
        break;
      }
    }

    if (headerLineIdx === -1) {
      throw new Error('Could not find header row. Expected columns: date/time, order id, sku, total');
    }

    console.log(`[Settlement Import] Header detected at line ${headerLineIdx}: ${headerLine.substring(0, 100)}`);

    // Parse CSV header with flexible mapping
    const headers = parseCSVLine(headerLine);
    const headerMap = {}; // Maps normalized header name -> column index

    headers.forEach((h, idx) => {
      const normalized = h.trim().toLowerCase().replace(/["\s]/g, '').replace(/[/-]/g, '');
      headerMap[normalized] = idx;
    });

    console.log(`[Settlement Import] Parsed headers:`, Object.keys(headerMap).slice(0, 10));

    // Check for critical columns only
    const hasOrderId = Object.keys(headerMap).some(h => h.includes('orderid') || h.includes('order'));
    const hasTotal = Object.keys(headerMap).some(h => h === 'total');

    if (!hasOrderId || !hasTotal) {
      throw new Error('Missing critical columns: need "order id" and "total"');
    }

    // Parse data rows
    const dataRows = lines.slice(headerLineIdx + 1);
    const settlementRows = [];
    const monthDates = [];
    let parseErrorCount = 0;

    for (const line of dataRows) {
      if (!line.trim()) continue;

      try {
        const fields = parseCSVLine(line);
        const row = {};
        
        // Build row object with flexible header mapping
        headers.forEach((h, idx) => {
          const normalized = h.trim().toLowerCase().replace(/["\s]/g, '').replace(/[/-]/g, '');
          row[normalized] = fields[idx] || '';
        });

        // Find datetime column (try multiple variants)
        let datetimeStr = '';
        const dateTimeKeys = Object.keys(row).filter(k => k.includes('date') || k.includes('time'));
        if (dateTimeKeys.length > 0) {
          datetimeStr = row[dateTimeKeys[0]] || '';
        }

        if (!datetimeStr) {
          parseErrorCount++;
          continue;
        }

        const datetime = new Date(datetimeStr);
        if (isNaN(datetime.getTime())) {
          parseErrorCount++;
          continue;
        }
        monthDates.push(datetime);

        // Find order_id (handle variations)
        let orderId = '';
        const orderIdKeys = Object.keys(row).filter(k => k.includes('order') && (k.includes('id') || k === 'order'));
        if (orderIdKeys.length > 0) {
          orderId = row[orderIdKeys[0]] || '';
        }
        if (!orderId) {
          parseErrorCount++;
          continue;
        }

        // Safe number parsing helper
        const safeParseFloat = (val) => {
          if (!val || typeof val !== 'string') return 0;
          const cleaned = val.trim().replace(/,/g, '');
          const parsed = parseFloat(cleaned);
          return isNaN(parsed) ? 0 : parsed;
        };

        // Parse quantities and amounts
        const quantityRaw = Object.keys(row).find(k => k === 'quantity');
        const quantity = Math.abs(safeParseFloat(row[quantityRaw]));

        const totalVal = safeParseFloat(row.total);

        // Determine sign based on type and total value
        const typeStr = (Object.keys(row).find(k => k === 'type') ? row[Object.keys(row).find(k => k === 'type')] : '').toLowerCase();
        const isRefund = typeStr.includes('refund') || totalVal < 0;
        const sign = isRefund ? -1 : 1;
        const signedQty = quantity * sign;

        const settlementRow = {
          tenant_id: tenantId,
          settlement_import_id: importJob.id,
          datetime: datetime.toISOString(),
          settlement_id: row[Object.keys(row).find(k => k === 'settlementid' || k.includes('settlement'))] || '',
          type: row[Object.keys(row).find(k => k === 'type')] || '',
          order_id: orderId,
          sku: row[Object.keys(row).find(k => k === 'sku')] || '',
          description: row[Object.keys(row).find(k => k === 'description')] || '',
          quantity: quantity,
          signed_qty: signedQty,
          marketplace: row[Object.keys(row).find(k => k === 'marketplace')] || '',
          fulfillment: row[Object.keys(row).find(k => k === 'fulfillment')] || '',
          order_city: row[Object.keys(row).find(k => k.includes('city'))] || '',
          order_state: row[Object.keys(row).find(k => k.includes('state'))] || '',
          order_postal: row[Object.keys(row).find(k => k.includes('postal') || k.includes('zip'))] || '',
          product_sales: safeParseFloat(row[Object.keys(row).find(k => k.includes('productsales') || k.includes('product'))]),
          shipping_credits: safeParseFloat(row[Object.keys(row).find(k => k.includes('shipping'))]),
          promotional_rebates: safeParseFloat(row[Object.keys(row).find(k => k.includes('promotional'))]),
          selling_fees: safeParseFloat(row[Object.keys(row).find(k => k.includes('sellingfees') || k.includes('selling'))]),
          fba_fees: safeParseFloat(row[Object.keys(row).find(k => k.includes('fba'))]),
          other_transaction_fees: safeParseFloat(row[Object.keys(row).find(k => k.includes('othertransaction'))]),
          other: safeParseFloat(row[Object.keys(row).find(k => k === 'other')]),
          total: totalVal,
          is_refund_like: isRefund,
          match_status: 'unmatched_order'
        };

        settlementRows.push(settlementRow);
      } catch (err) {
        parseErrorCount++;
        console.warn(`Error parsing row:`, err.message);
      }
    }

    if (settlementRows.length === 0) {
      throw new Error(`No valid data rows found. Total rows in file: ${lines.length}, Parse errors: ${parseErrorCount}`);
    }

    console.log(`[Settlement Import] Parsed ${settlementRows.length} valid rows (${parseErrorCount} errors). Sample row:`, settlementRows[0]);

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