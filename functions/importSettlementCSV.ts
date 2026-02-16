import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { normalizeOrderId } from './helpers/normalizeOrderId.js';

const EXPECTED_HEADERS_MAP = {
  'datetime': ['date/time', 'datetime', 'date', 'time', 'transaction date'],
  'settlement_id': ['settlement id', 'settlementid', 'settlement-id'],
  'type': ['type', 'transaction type'],
  'order_id': ['order id', 'orderid', 'order-id', 'amazon order id'],
  'sku': ['sku', 'product sku', 'asin'],
  'quantity': ['quantity', 'qty'],
  'marketplace': ['marketplace', 'market place'],
  'fulfillment': ['fulfillment', 'fulfillment channel'],
  'product_sales': ['product sales', 'product sale'],
  'shipping_credits': ['shipping credits'],
  'promotional_rebates': ['promotional rebates', 'promotional discount'],
  'selling_fees': ['selling fees', 'selling fee'],
  'fba_fees': ['fba fees', 'fulfillment fees'],
  'other_transaction_fees': ['other transaction fees', 'transaction fees'],
  'other': ['other'],
  'total': ['total', 'total amount', 'net'],
  'description': ['description'],
  'order_city': ['order city', 'city'],
  'order_state': ['order state', 'state'],
  'order_postal': ['order postal', 'postal', 'zip']
};

Deno.serve(async (req) => {
  let importJob = null;
  try {
    const base44 = createClientFromRequest(req);
    
    // Parse JSON body
    const body = await req.json();
    const fileName = body.file_name;
    const fileContentBase64 = body.file_content;
    const tenantId = body.workspace_id;

    console.log(`[Settlement] Request received. FileName: ${fileName}, TenantID: ${tenantId}`);

    // Validate required fields
    if (!fileContentBase64) {
      return Response.json({
        code: 'VALIDATION_ERROR',
        message: 'Missing CSV file content',
        details: []
      }, { status: 400 });
    }

    if (!tenantId) {
      return Response.json({
        code: 'VALIDATION_ERROR',
        message: 'Missing workspace ID',
        details: []
      }, { status: 400 });
    }

    if (!fileName) {
      return Response.json({
        code: 'VALIDATION_ERROR',
        message: 'Missing file name',
        details: []
      }, { status: 400 });
    }

    // Decode base64 to text
    let csvText;
    try {
      csvText = new TextDecoder().decode(
        Uint8Array.from(atob(fileContentBase64), c => c.charCodeAt(0))
      );
    } catch (err) {
      return Response.json({
        code: 'VALIDATION_ERROR',
        message: 'Invalid base64 file content',
        details: [err.message]
      }, { status: 400 });
    }

    // Authenticate user
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({
        code: 'VALIDATION_ERROR',
        message: 'Unauthorized',
        details: []
      }, { status: 401 });
    }

    console.log(`[Settlement] User authenticated: ${user.email}, UserID: ${user.id}, TenantID: ${tenantId}`);

    // TASK 1 FIX: Use tenantId consistently (not undefined workspaceId)
    try {
      const memberships = await base44.asServiceRole.entities.Membership.filter({
        user_id: user.id,
        tenant_id: tenantId
      });

      if (memberships.length === 0) {
        console.error(`[Settlement] Access denied: user ${user.id} has no membership in tenant ${tenantId}`);
        return Response.json({
          code: 'FORBIDDEN',
          message: 'No access to this workspace',
          details: []
        }, { status: 403 });
      }
      
      console.log(`[Settlement] Workspace access verified for user ${user.id} in tenant ${tenantId}`);
    } catch (err) {
      console.error(`[Settlement] Membership check failed:`, err);
      return Response.json({
        code: 'FORBIDDEN',
        message: 'Failed to verify workspace access',
        details: [err.message]
      }, { status: 403 });
    }

    // Create import job
    importJob = await base44.asServiceRole.entities.SettlementImport.create({
      tenant_id: tenantId,
      file_name: fileName,
      uploaded_by_user_id: user.id,
      status: 'processing',
      import_started_at: new Date().toISOString()
    });

    console.log(`[Settlement] Import job created. ID: ${importJob.id}, File: ${fileName}`);

    // Process CSV text
    const bomDetected = csvText.startsWith('\uFEFF');
    const cleanText = csvText.replace(/^\uFEFF/, ''); // Remove BOM if present

    if (!cleanText.trim()) {
      await base44.asServiceRole.entities.SettlementImport.update(importJob.id, {
        status: 'failed',
        error_message: 'File is empty',
        import_completed_at: new Date().toISOString()
      });

      return Response.json({
        code: 'VALIDATION_ERROR',
        message: 'File is empty',
        details: []
      }, { status: 400 });
    }

    // Split by newline (keep non-empty)
    const lines = cleanText.split(/\r\n|\n/).filter(l => l.trim().length > 0);

    if (lines.length === 0) {
      await base44.asServiceRole.entities.SettlementImport.update(importJob.id, {
        status: 'failed',
        error_message: 'File contains no data rows',
        import_completed_at: new Date().toISOString()
      });

      return Response.json({
        code: 'VALIDATION_ERROR',
        message: 'File contains no data rows',
        details: []
      }, { status: 400 });
    }

    console.log(`[Settlement] File parsed. Total lines: ${lines.length}, BOM: ${bomDetected}, File: ${fileName}`);

    // Find header row - first line matching expected settlement report format
    let headerLineIdx = -1;
    let headerLine = '';

    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      const lowerLine = lines[i].toLowerCase();
      const hasDateTime = lowerLine.includes('date') && (lowerLine.includes('time') || lowerLine.includes('/'));
      const hasOrder = lowerLine.includes('order');
      const hasSku = lowerLine.includes('sku');
      const hasTotal = lowerLine.includes('total');

      if (hasDateTime && hasOrder && hasSku && hasTotal) {
        headerLineIdx = i;
        headerLine = lines[i];
        break;
      }
    }

    if (headerLineIdx === -1) {
      return Response.json({
        code: 'UNSUPPORTED_FORMAT',
        message: 'Could not find valid header row. Expected columns: date/time, order id, sku, total',
        details: [],
        sampleExpectedHeaders: ['date/time', 'order id', 'sku', 'total', 'product sales', 'shipping credits']
      }, { status: 400 });
    }

    // Parse CSV header with flexible alias mapping
    const rawHeaders = parseCSVLine(headerLine);
    const headerMap = {}; // Maps canonical key -> column index

    rawHeaders.forEach((h, idx) => {
      const normalized = h.trim().toLowerCase();
      
      // Try to match against expected headers
      for (const [canonicalKey, aliases] of Object.entries(EXPECTED_HEADERS_MAP)) {
        if (aliases.some(alias => normalized.includes(alias))) {
          headerMap[canonicalKey] = idx;
          break;
        }
      }
    });

    console.log(`[Settlement] File: ${fileName}, BOM: ${bomDetected}, Header at line ${headerLineIdx}, Columns: ${rawHeaders.length}, Mapped: ${Object.keys(headerMap).length}`, headerMap);

    // Validate required column mappings
    if (!headerMap.order_id) {
      return Response.json({
        code: 'UNSUPPORTED_FORMAT',
        message: 'Required column "order id" not found in header',
        details: [],
        sampleExpectedHeaders: ['date/time', 'order id', 'sku', 'total']
      }, { status: 400 });
    }

    if (!headerMap.total) {
      return Response.json({
        code: 'UNSUPPORTED_FORMAT',
        message: 'Required column "total" not found in header',
        details: [],
        sampleExpectedHeaders: ['date/time', 'order id', 'sku', 'total']
      }, { status: 400 });
    }

    // Parse data rows
    const dataRows = lines.slice(headerLineIdx + 1);
    const settlementRows = [];
    const monthDates = [];
    const parseErrors = [];

    // Safe number parsing helper
    const safeParseFloat = (val) => {
      if (!val || typeof val !== 'string') return 0;
      const cleaned = val.trim().replace(/,/g, '').replace(/[$%]/g, '');
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? 0 : parsed;
    };

    // Get column indices by canonical key
    const getFieldValue = (fields, key) => {
      const idx = headerMap[key];
      return idx !== undefined ? (fields[idx] || '').trim() : '';
    };

    for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
      const line = dataRows[rowIdx];
      if (!line.trim()) continue;

      try {
        const fields = parseCSVLine(line);

        // Extract fields using mapped headers
        const datetimeStr = getFieldValue(fields, 'datetime');
        const orderId = getFieldValue(fields, 'order_id');
        const sku = getFieldValue(fields, 'sku');
        const totalStr = getFieldValue(fields, 'total');

        // Validate critical fields
        if (!datetimeStr) {
          parseErrors.push({ row: headerLineIdx + rowIdx + 2, column: 'date/time', reason: 'Missing date/time value' });
          continue;
        }

        if (!orderId) {
          parseErrors.push({ row: headerLineIdx + rowIdx + 2, column: 'order id', reason: 'Missing order ID' });
          continue;
        }

        if (!totalStr) {
          parseErrors.push({ row: headerLineIdx + rowIdx + 2, column: 'total', reason: 'Missing total amount' });
          continue;
        }

        // Parse datetime
        const datetime = new Date(datetimeStr);
        if (isNaN(datetime.getTime())) {
          parseErrors.push({ row: headerLineIdx + rowIdx + 2, column: 'date/time', reason: `Invalid format: "${datetimeStr}"` });
          continue;
        }
        monthDates.push(datetime);

        // Parse amounts
        const total = safeParseFloat(totalStr);

        // Determine sign
        const typeStr = (getFieldValue(fields, 'type') || '').toLowerCase();
        const isRefund = typeStr.includes('refund') || total < 0;
        const sign = isRefund ? -1 : 1;
        const quantity = Math.abs(safeParseFloat(getFieldValue(fields, 'quantity')));
        const signedQty = quantity * sign;

        // TASK 2 FIX: Store both raw and normalized order ID
        const settlementRow = {
          tenant_id: tenantId,
          settlement_import_id: importJob.id,
          datetime: datetime.toISOString(),
          settlement_id: getFieldValue(fields, 'settlement_id'),
          type: getFieldValue(fields, 'type'),
          order_id: orderId,
          raw_order_id: orderId,
          normalized_order_id: normalizeOrderId(orderId),
          sku: sku,
          description: getFieldValue(fields, 'description'),
          quantity: quantity,
          signed_qty: signedQty,
          marketplace: getFieldValue(fields, 'marketplace'),
          fulfillment: getFieldValue(fields, 'fulfillment'),
          order_city: getFieldValue(fields, 'order_city'),
          order_state: getFieldValue(fields, 'order_state'),
          order_postal: getFieldValue(fields, 'order_postal'),
          product_sales: safeParseFloat(getFieldValue(fields, 'product_sales')),
          shipping_credits: safeParseFloat(getFieldValue(fields, 'shipping_credits')),
          promotional_rebates: safeParseFloat(getFieldValue(fields, 'promotional_rebates')),
          selling_fees: safeParseFloat(getFieldValue(fields, 'selling_fees')),
          fba_fees: safeParseFloat(getFieldValue(fields, 'fba_fees')),
          other_transaction_fees: safeParseFloat(getFieldValue(fields, 'other_transaction_fees')),
          other: safeParseFloat(getFieldValue(fields, 'other')),
          total: total,
          is_refund_like: isRefund,
          match_status: 'unmatched_order'
        };

        settlementRows.push(settlementRow);
      } catch (err) {
        parseErrors.push({ row: headerLineIdx + rowIdx + 2, column: 'general', reason: err.message });
      }
    }

    if (settlementRows.length === 0) {
      return Response.json({
        code: 'PARSER_ERROR',
        message: `No valid data rows could be parsed. ${parseErrors.length} parsing errors found.`,
        details: parseErrors.slice(0, 50),
        totalErrors: parseErrors.length
      }, { status: 400 });
    }

    console.log(`[Settlement] Import: ${fileName}, Rows: ${settlementRows.length}, Errors: ${parseErrors.length}`);

    // Bulk insert rows
    const insertedRows = await base44.asServiceRole.entities.SettlementRow.bulkCreate(settlementRows);

    // Fetch OMS data for matching
    const [orders, skus, orderLines] = await Promise.all([
      base44.asServiceRole.entities.Order.filter({ tenant_id: tenantId, is_deleted: false }),
      base44.asServiceRole.entities.SKU.filter({ tenant_id: tenantId }),
      base44.asServiceRole.entities.OrderLine.filter({ tenant_id: tenantId })
    ]);

    // TASK 3 FIX: Match using canonical normalization
    let matchedCount = 0;
    const updateBatch = [];

    for (let i = 0; i < settlementRows.length; i++) {
      const row = settlementRows[i];
      const insertedRow = insertedRows[i];
      let matchStatus = 'unmatched_order';
      let matchedOrderId = null;
      let matchedSkuId = null;
      let matchStrategy = null;
      let notFoundReason = 'Order not found after normalization';

      const normalizedRowOrderId = normalizeOrderId(row.order_id);

      // TASK 3: Primary match against amazon_order_id using normalization
      const matchedOrder = orders.find(o => normalizeOrderId(o.amazon_order_id) === normalizedRowOrderId);
      
      if (matchedOrder) {
        matchedOrderId = matchedOrder.id;
        matchStrategy = 'normalized_amazon_id';
        
        // Try to find SKU
        const matchedSku = skus.find(s => 
          s.sku_code === row.sku || 
          normalizeOrderId(s.sku_code) === normalizeOrderId(row.sku)
        );
        
        if (matchedSku) {
          matchedSkuId = matchedSku.id;
          matchStatus = 'matched';
          matchedCount++;
          notFoundReason = null;
          
          // Check COGS data
          if (!matchedOrder.total_cost || matchedOrder.total_cost === 0) {
            const lines = orderLines.filter(l => l.order_id === matchedOrder.id);
            const computedCogs = lines.reduce((sum, l) => sum + ((l.unit_cost || 0) * (l.quantity || 0)), 0);
            
            if (computedCogs === 0) {
              notFoundReason = 'Order matched but COGS missing';
            }
          }
        } else {
          // TASK 6 FIX: Keep matched_order_id even if SKU missing
          matchStatus = 'unmatched_sku';
          notFoundReason = 'Order matched, SKU not found';
        }
      }

      // Collect update
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

    // Batch updates
    const BATCH_SIZE = 100;
    for (let i = 0; i < updateBatch.length; i += BATCH_SIZE) {
      const chunk = updateBatch.slice(i, i + BATCH_SIZE);
      await Promise.all(
        chunk.map(item =>
          base44.asServiceRole.entities.SettlementRow.update(item.id, item.data)
        )
      );
      if (i + BATCH_SIZE < updateBatch.length) {
        await new Promise(resolve => setTimeout(resolve, 800));
      }
    }

    const unmatchedCount = settlementRows.length - matchedCount;

    // TASK 4 FIX: Re-read updated rows for accurate totals computation
    const updatedRows = await base44.asServiceRole.entities.SettlementRow.filter({
      settlement_import_id: importJob.id,
      is_deleted: false
    });

    const totalRevenue = updatedRows.reduce((sum, r) => sum + r.total, 0);
    const matchedRows = updatedRows.filter(r => r.match_status === 'matched');
    
    let totalCogs = 0;
    for (const row of matchedRows) {
      if (row.matched_order_id) {
        const order = orders.find(o => o.id === row.matched_order_id);
        if (order && order.total_cost) {
          // Use order's total_cost proportionally
          totalCogs += order.total_cost * (row.signed_qty / (order.net_revenue || 1));
        } else {
          // Fallback to SKU cost
          const sku = skus.find(s => s.id === row.matched_sku_id);
          if (sku && sku.cost_price) {
            totalCogs += sku.cost_price * row.signed_qty;
          }
        }
      }
    }

    const totalProfit = totalRevenue - totalCogs;
    const margin = totalRevenue !== 0 ? ((totalRevenue - totalCogs) / totalRevenue) : 0;

    // TASK 4: Integrity warning if matched but COGS is zero
    if (matchedCount > 0 && totalCogs === 0) {
      console.warn(`[Settlement] Import ${importJob.id}: ${matchedCount} matched rows but COGS = 0. Possible data integrity issue.`);
    }

    const monthKey = monthDates.length > 0 
      ? monthDates[0].toISOString().substring(0, 7)
      : new Date().toISOString().substring(0, 7);

    // Update import job with correct counts
    await base44.asServiceRole.entities.SettlementImport.update(importJob.id, {
      status: 'completed',
      month_key: monthKey,
      rows_count: updatedRows.length,
      matched_rows_count: matchedRows.length,
      unmatched_rows_count: updatedRows.length - matchedRows.length,
      totals_cached_json: {
        total_revenue: totalRevenue,
        total_cogs: totalCogs,
        total_profit: totalProfit,
        margin: margin,
        orders_count: new Set(updatedRows.map(r => r.order_id)).size,
        skus_count: new Set(updatedRows.map(r => r.sku)).size
      },
      import_completed_at: new Date().toISOString()
    });

    return Response.json({
      success: true,
      importId: importJob.id,
      rowsCount: updatedRows.length,
      matchedCount: matchedRows.length,
      unmatchedCount: updatedRows.length - matchedRows.length,
      parseErrors: parseErrors.length > 0 ? parseErrors.slice(0, 50) : [],
      totalParseErrors: parseErrors.length,
      totals: {
        total_revenue: totalRevenue,
        total_cogs: totalCogs,
        total_profit: totalProfit,
        margin: margin
      }
    });
  } catch (error) {
    console.error('Settlement import error:', error);
    
    // Try to update import job with error
    if (importJob?.id) {
      try {
        await base44.asServiceRole.entities.SettlementImport.update(importJob.id, {
          status: 'failed',
          error_message: error.message,
          import_completed_at: new Date().toISOString()
        });
      } catch (updateErr) {
        console.error('Failed to update import job:', updateErr);
      }
    }

    return Response.json({
      code: 'IMPORT_ERROR',
      message: error.message,
      details: []
    }, { status: 500 });
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