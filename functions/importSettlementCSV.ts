import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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
    // Parse JSON body first (before creating base44 client)
    const body = await req.json();
    const fileName = body.file_name;
    const fileContentBase64 = body.file_content;
    const workspaceId = body.workspace_id;
    const monthKey = body.month_key;

    console.log(`[Settlement] Request received. FileName: ${fileName}, WorkspaceID: ${workspaceId}`);

    // Now create the client after body is parsed
    const base44 = createClientFromRequest(req);

    // Validate required fields
    if (!fileContentBase64) {
      return Response.json({
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Missing CSV file content. Expected field: "file_content" (base64)',
        missing: ['file_content'],
        received: Object.keys(body)
      }, { status: 400 });
    }

    if (!workspaceId) {
      return Response.json({
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Missing workspace ID. Expected field: "workspace_id"',
        missing: ['workspace_id'],
        received: Object.keys(body)
      }, { status: 400 });
    }

    if (!fileName) {
      return Response.json({
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Missing file name. Expected field: "file_name"',
        missing: ['file_name'],
        received: Object.keys(body)
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
        ok: false,
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

    // Verify user has access to workspace
    try {
      const memberships = await base44.asServiceRole.entities.Membership.filter({
        user_id: user.id,
        tenant_id: workspaceId
      });

      if (memberships.length === 0) {
        return Response.json({
          code: 'VALIDATION_ERROR',
          message: 'No access to this workspace',
          details: []
        }, { status: 403 });
      }
    } catch (err) {
      console.warn(`[Settlement] Workspace access check failed: ${err.message}`);
    }

    // Create import job
    importJob = await base44.asServiceRole.entities.SettlementImport.create({
      tenant_id: workspaceId,
      file_name: fileName,
      uploaded_by_user_id: user.id,
      status: 'processing',
      month_key: monthKey,
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

        const settlementRow = {
          tenant_id: tenantId,
          settlement_import_id: importJob.id,
          datetime: datetime.toISOString(),
          settlement_id: getFieldValue(fields, 'settlement_id'),
          type: getFieldValue(fields, 'type'),
          order_id: orderId,
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
    const [orders, skus] = await Promise.all([
      base44.asServiceRole.entities.Order.filter({ tenant_id: tenantId }),
      base44.asServiceRole.entities.SKU.filter({ tenant_id: tenantId })
    ]);

    // Match rows
    let matchedCount = 0;

    for (let i = 0; i < settlementRows.length; i++) {
      const row = settlementRows[i];
      const insertedRow = insertedRows[i];
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
        }
      }

      // Update settlement row with match info
      if (insertedRow?.id) {
        await base44.asServiceRole.entities.SettlementRow.update(insertedRow.id, {
          matched_order_id: matchedOrderId,
          matched_sku_id: matchedSkuId,
          match_status: matchStatus
        });
      }
    }

    const unmatchedCount = settlementRows.length - matchedCount;

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
      parseErrors: parseErrors.length > 0 ? parseErrors.slice(0, 50) : [],
      totalParseErrors: parseErrors.length,
      totals: {
        total_revenue: totalRevenue,
        total_cogs: totalCogs,
        total_profit: totalRevenue - totalCogs,
        margin: totalRevenue !== 0 ? ((totalRevenue - totalCogs) / totalRevenue) : 0
      }
    });
  } catch (error) {
    console.error('Settlement import error:', error);
    
    // Try to update import job with error
    try {
      await base44.asServiceRole.entities.SettlementImport.update(importJob.id, {
        status: 'failed',
        error_message: error.message,
        import_completed_at: new Date().toISOString()
      });
    } catch (updateErr) {
      console.error('Failed to update import job:', updateErr);
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