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

const safeParseFloat = (val) => {
  if (!val || typeof val !== 'string') return 0;
  const cleaned = val.trim().replace(/,/g, '').replace(/[$%]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
};

const getFieldValue = (fields, key, headerMap) => {
  const idx = headerMap[key];
  return idx !== undefined ? (fields[idx] || '').trim() : '';
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const fileName = body.file_name;
    const fileContentBase64 = body.file_content;
    const tenantId = body.workspace_id;

    // Validate inputs
    if (!fileContentBase64 || !tenantId || !fileName) {
      return Response.json({
        code: 'VALIDATION_ERROR',
        message: 'Missing required fields',
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

    // Decode base64
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

    // Parse CSV
    const bomDetected = csvText.startsWith('\uFEFF');
    const cleanText = csvText.replace(/^\uFEFF/, '');

    if (!cleanText.trim()) {
      return Response.json({
        code: 'VALIDATION_ERROR',
        message: 'File is empty',
        details: []
      }, { status: 400 });
    }

    const lines = cleanText.split(/\r\n|\n/).filter(l => l.trim().length > 0);

    if (lines.length === 0) {
      return Response.json({
        code: 'VALIDATION_ERROR',
        message: 'File contains no data rows',
        details: []
      }, { status: 400 });
    }

    // Find header row
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
        message: 'Could not find valid header row',
        details: [],
        sampleExpectedHeaders: ['date/time', 'order id', 'sku', 'total']
      }, { status: 400 });
    }

    // Parse header
    const rawHeaders = parseCSVLine(headerLine);
    const headerMap = {};

    rawHeaders.forEach((h, idx) => {
      const normalized = h.trim().toLowerCase();
      for (const [canonicalKey, aliases] of Object.entries(EXPECTED_HEADERS_MAP)) {
        if (aliases.some(alias => normalized.includes(alias))) {
          headerMap[canonicalKey] = idx;
          break;
        }
      }
    });

    if (!headerMap.order_id || !headerMap.total) {
      return Response.json({
        code: 'UNSUPPORTED_FORMAT',
        message: 'Required columns not found',
        details: [],
        sampleExpectedHeaders: ['date/time', 'order id', 'sku', 'total']
      }, { status: 400 });
    }

    // Parse data rows
    const dataRows = lines.slice(headerLineIdx + 1);
    const settlementRows = [];
    const monthDates = [];
    const parseErrors = [];

    for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
      const line = dataRows[rowIdx];
      if (!line.trim()) continue;

      try {
        const fields = parseCSVLine(line);

        const datetimeStr = getFieldValue(fields, 'datetime', headerMap);
        const orderId = getFieldValue(fields, 'order_id', headerMap);
        const sku = getFieldValue(fields, 'sku', headerMap);
        const totalStr = getFieldValue(fields, 'total', headerMap);

        if (!datetimeStr || !orderId || !totalStr) {
          parseErrors.push({
            row: headerLineIdx + rowIdx + 2,
            column: !datetimeStr ? 'date/time' : !orderId ? 'order id' : 'total',
            reason: 'Missing required value'
          });
          continue;
        }

        const datetime = new Date(datetimeStr);
        if (isNaN(datetime.getTime())) {
          parseErrors.push({ row: headerLineIdx + rowIdx + 2, column: 'date/time', reason: `Invalid format: "${datetimeStr}"` });
          continue;
        }
        monthDates.push(datetime);

        const total = safeParseFloat(totalStr);
        const typeStr = (getFieldValue(fields, 'type', headerMap) || '').toLowerCase();
        const isRefund = typeStr.includes('refund') || total < 0;
        const sign = isRefund ? -1 : 1;
        const quantity = Math.abs(safeParseFloat(getFieldValue(fields, 'quantity', headerMap)));

        settlementRows.push({
          tenant_id: tenantId,
          datetime: datetime.toISOString(),
          settlement_id: getFieldValue(fields, 'settlement_id', headerMap),
          type: getFieldValue(fields, 'type', headerMap),
          order_id: orderId,
          sku: sku,
          description: getFieldValue(fields, 'description', headerMap),
          quantity: quantity,
          signed_qty: quantity * sign,
          marketplace: getFieldValue(fields, 'marketplace', headerMap),
          fulfillment: getFieldValue(fields, 'fulfillment', headerMap),
          order_city: getFieldValue(fields, 'order_city', headerMap),
          order_state: getFieldValue(fields, 'order_state', headerMap),
          order_postal: getFieldValue(fields, 'order_postal', headerMap),
          product_sales: safeParseFloat(getFieldValue(fields, 'product_sales', headerMap)),
          shipping_credits: safeParseFloat(getFieldValue(fields, 'shipping_credits', headerMap)),
          promotional_rebates: safeParseFloat(getFieldValue(fields, 'promotional_rebates', headerMap)),
          selling_fees: safeParseFloat(getFieldValue(fields, 'selling_fees', headerMap)),
          fba_fees: safeParseFloat(getFieldValue(fields, 'fba_fees', headerMap)),
          other_transaction_fees: safeParseFloat(getFieldValue(fields, 'other_transaction_fees', headerMap)),
          other: safeParseFloat(getFieldValue(fields, 'other', headerMap)),
          total: total,
          is_refund_like: isRefund,
          match_status: 'unmatched_order'
        });
      } catch (err) {
        parseErrors.push({ row: headerLineIdx + rowIdx + 2, column: 'general', reason: err.message });
      }
    }

    if (settlementRows.length === 0) {
      return Response.json({
        code: 'PARSER_ERROR',
        message: `No valid data rows could be parsed`,
        details: parseErrors.slice(0, 50),
        totalErrors: parseErrors.length
      }, { status: 400 });
    }

    const monthKey = monthDates.length > 0
      ? monthDates[0].toISOString().substring(0, 7)
      : new Date().toISOString().substring(0, 7);

    // Create import job
    const importJob = await base44.asServiceRole.entities.SettlementImport.create({
      tenant_id: tenantId,
      file_name: fileName,
      uploaded_by_user_id: user.id,
      status: 'queued',
      month_key: monthKey,
      total_rows: settlementRows.length,
      processed_rows: 0,
      cursor: 0,
      chunk_size: 400,
      parse_errors_json: JSON.stringify(parseErrors.slice(0, 100)),
      total_parse_errors: parseErrors.length,
      parsed_rows_json: JSON.stringify(settlementRows),
      header_map_json: JSON.stringify(headerMap),
      import_started_at: new Date().toISOString()
    });

    return Response.json({
      ok: true,
      import_id: importJob.id,
      total_rows: settlementRows.length,
      chunk_size: 400,
      parse_errors: parseErrors.slice(0, 20),
      total_parse_errors: parseErrors.length
    });
  } catch (error) {
    console.error('Settlement import phase A error:', error);
    return Response.json({
      code: 'IMPORT_ERROR',
      message: error.message,
      details: []
    }, { status: 500 });
  }
});