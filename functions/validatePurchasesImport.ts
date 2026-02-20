import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { parse as parseDate } from 'npm:date-fns@3.6.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tenant_id, rows } = await req.json();

    if (!tenant_id || !Array.isArray(rows)) {
      return Response.json({ error: 'tenant_id and rows required' }, { status: 400 });
    }

    // Preload SKUs and Suppliers for workspace
    const [skus, suppliers] = await Promise.all([
      base44.asServiceRole.entities.SKU.filter({ tenant_id }),
      base44.asServiceRole.entities.Supplier.filter({ tenant_id })
    ]);

    const skuMap = {};
    skus.forEach(sku => {
      const key = (sku.sku_code || '').trim().toLowerCase();
      if (key) {
        skuMap[key] = sku;
      }
    });

    const supplierMap = {};
    suppliers.forEach(s => {
      const key = (s.supplier_name || '').trim().toLowerCase();
      if (key) {
        supplierMap[key] = s;
      }
    });

    const errors = [];
    let validCount = 0;

    rows.forEach((row, idx) => {
      const rowNum = idx + 1;
      const issues = [];

      // SKU code validation
      const skuCode = (row.sku_code || '').trim();
      if (!skuCode) {
        issues.push('SKU code required');
      } else if (!skuMap[skuCode.toLowerCase()]) {
        issues.push('SKU not found');
      }

      // Quantity validation
      const qty = row.quantity ? parseInt(row.quantity) : null;
      if (qty === null || isNaN(qty) || qty < 1) {
        issues.push('Quantity must be >= 1');
      }

      // Unit price validation (optional, but if provided must be valid)
      if (row.unit_price) {
        const price = parseFloat(row.unit_price);
        if (isNaN(price) || price < 0) {
          issues.push('Unit price must be valid number >= 0');
        }
      }

      // Date validation (optional, but if provided must be parseable)
      if (row.purchase_date) {
        const dateStr = row.purchase_date.trim();
        const parsed = parseDate(dateStr, 'yyyy-MM-dd', new Date());
        if (isNaN(parsed.getTime())) {
          issues.push('Date must be yyyy-MM-dd format');
        }
      }

      if (issues.length > 0) {
        errors.push({
          row: rowNum,
          sku_code: skuCode,
          issues: issues.join('; ')
        });
      } else {
        validCount++;
      }
    });

    return Response.json({
      ok: true,
      valid_count: validCount,
      invalid_count: errors.length,
      total: rows.length,
      errors: errors.slice(0, 10) // Top 10 errors
    });

  } catch (error) {
    console.error('[Validate Purchases] Error:', error);
    return Response.json({
      error: error.message || 'Validation failed'
    }, { status: 500 });
  }
});