import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as XLSX from 'npm:xlsx@0.18.5';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file');
    const tenantId = formData.get('tenantId');

    if (!file || !tenantId) {
      return Response.json({ error: 'Missing file or tenantId' }, { status: 400 });
    }

    // Read Excel file
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(firstSheet);

    if (rows.length === 0) {
      return Response.json({ error: 'Excel file is empty' }, { status: 400 });
    }

    // Create import batch
    const batch = await base44.entities.ProfitabilityImportBatch.create({
      tenant_id: tenantId,
      file_name: file.name,
      status: 'processing',
      uploaded_by: user.email,
      total_rows: rows.length
    });

    // Normalize function (same as helper)
    const normalize = (str) => {
      if (!str) return '';
      return String(str).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    };

    // Load all fulfilled orders and their lines for this workspace
    const orders = await base44.entities.Order.filter({ 
      tenant_id: tenantId,
      status: 'fulfilled'
    });

    const orderLines = await base44.entities.OrderLine.filter({ tenant_id: tenantId });
    const skus = await base44.entities.SKU.filter({ tenant_id: tenantId });

    // Build lookup maps
    const skuMap = {};
    skus.forEach(sku => {
      skuMap[sku.id] = sku;
    });

    const orderMap = {};
    orders.forEach(order => {
      const normalizedOrderId = normalize(order.amazon_order_id);
      if (!orderMap[normalizedOrderId]) {
        orderMap[normalizedOrderId] = order;
      }
    });

    const orderLinesMap = {};
    orderLines.forEach(line => {
      const order = orders.find(o => o.id === line.order_id);
      if (!order) return;
      
      const normalizedOrderId = normalize(order.amazon_order_id);
      const normalizedSku = normalize(line.sku_code);
      const key = `${normalizedOrderId}_${normalizedSku}_${line.quantity}`;
      
      orderLinesMap[key] = {
        ...line,
        order,
        sku: skuMap[line.sku_id]
      };
    });

    // Process rows
    const matched = [];
    const unmatched = [];
    const errorSummary = {
      ORDER_NOT_FOUND: 0,
      SKU_NOT_FOUND_IN_ORDER: 0,
      QTY_MISMATCH: 0,
      DUPLICATE_INPUT_ROW: 0
    };

    const seenKeys = new Set();

    for (const row of rows) {
      const orderId = normalize(row.order_id || row.Order_ID || row.OrderID || '');
      const sku = normalize(row.sku || row.SKU || row.sku_code || '');
      const qty = Number(row.qty || row.Qty || row.quantity || row.Quantity || 0);
      const revenue = Number(row.revenue_total || row.Revenue || row.revenue || 0);

      if (!orderId || !sku || !qty || !revenue) {
        unmatched.push({
          ...row,
          reason: 'MISSING_REQUIRED_FIELDS',
          parsed: { orderId, sku, qty, revenue }
        });
        continue;
      }

      const matchKey = `${orderId}_${sku}_${qty}`;

      // Check for duplicate in upload
      if (seenKeys.has(matchKey)) {
        errorSummary.DUPLICATE_INPUT_ROW++;
        unmatched.push({
          ...row,
          reason: 'DUPLICATE_INPUT_ROW',
          parsed: { orderId, sku, qty, revenue }
        });
        continue;
      }
      seenKeys.add(matchKey);

      // Try to match
      const orderLineMatch = orderLinesMap[matchKey];

      if (!orderLineMatch) {
        // Check if order exists
        if (!orderMap[orderId]) {
          errorSummary.ORDER_NOT_FOUND++;
          unmatched.push({
            ...row,
            reason: 'ORDER_NOT_FOUND',
            parsed: { orderId, sku, qty, revenue }
          });
        } else {
          // Order exists but sku/qty doesn't match
          const orderLinesForOrder = Object.values(orderLinesMap).filter(ol => 
            normalize(ol.order.amazon_order_id) === orderId
          );
          
          const skuExists = orderLinesForOrder.some(ol => normalize(ol.sku_code) === sku);
          
          if (!skuExists) {
            errorSummary.SKU_NOT_FOUND_IN_ORDER++;
            unmatched.push({
              ...row,
              reason: 'SKU_NOT_FOUND_IN_ORDER',
              parsed: { orderId, sku, qty, revenue }
            });
          } else {
            errorSummary.QTY_MISMATCH++;
            unmatched.push({
              ...row,
              reason: 'QTY_MISMATCH',
              parsed: { orderId, sku, qty, revenue }
            });
          }
        }
        continue;
      }

      // Match found - calculate profitability
      const unitCost = orderLineMatch.unit_cost || orderLineMatch.sku?.cost_price || 0;
      const totalCost = unitCost * qty;
      const profit = revenue - totalCost;
      const marginPercent = revenue > 0 ? (profit / revenue) * 100 : 0;

      matched.push({
        tenant_id: tenantId,
        order_id: orderLineMatch.order_id,
        order_line_id: orderLineMatch.id,
        amazon_order_id: orderLineMatch.order.amazon_order_id,
        sku_code: orderLineMatch.sku_code,
        quantity: qty,
        unit_cost: unitCost,
        total_cost: totalCost,
        revenue,
        profit,
        margin_percent: marginPercent,
        match_status: 'matched',
        import_batch_id: batch.id,
        uploaded_by: user.email,
        uploaded_at: new Date().toISOString()
      });
    }

    // Delete existing profitability lines for matched order_lines (for idempotent re-upload)
    const existingProfLines = await base44.entities.ProfitabilityLine.filter({ tenant_id: tenantId });
    const matchedOrderLineIds = new Set(matched.map(m => m.order_line_id));
    
    for (const existing of existingProfLines) {
      if (matchedOrderLineIds.has(existing.order_line_id)) {
        await base44.entities.ProfitabilityLine.delete(existing.id);
      }
    }

    // Insert matched profitability lines
    if (matched.length > 0) {
      await base44.entities.ProfitabilityLine.bulkCreate(matched);
    }

    // Update batch
    await base44.entities.ProfitabilityImportBatch.update(batch.id, {
      status: 'completed',
      matched_rows: matched.length,
      unmatched_rows: unmatched.length,
      qty_mismatch_rows: errorSummary.QTY_MISMATCH,
      error_summary: errorSummary,
      unmatched_data: JSON.stringify(unmatched)
    });

    return Response.json({
      success: true,
      batchId: batch.id,
      total: rows.length,
      matched: matched.length,
      unmatched: unmatched.length,
      errorSummary,
      unmatchedRows: unmatched
    });

  } catch (error) {
    console.error('Profitability import error:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});