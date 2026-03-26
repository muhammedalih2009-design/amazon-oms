import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import ExcelJS from 'npm:exceljs@4.4.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { items, fileName } = await req.json();

    if (!items || !Array.isArray(items)) {
      return Response.json({ error: 'Invalid items data' }, { status: 400 });
    }

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Purchase Requests');

    // Define columns
    sheet.columns = [
      { header: 'SKU Code', key: 'sku_code', width: 15 },
      { header: 'Supplier', key: 'supplier', width: 25 },
      { header: 'Product', key: 'product_name', width: 40 },
      { header: 'Needed', key: 'total_needed', width: 10 },
      { header: 'In Stock', key: 'available', width: 10 },
      { header: 'To Buy', key: 'to_buy', width: 10 },
      { header: 'Unit Cost', key: 'unit_cost', width: 12 },
      { header: 'Total Cost', key: 'total_cost', width: 14 }
    ];

    // Style header row
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    sheet.getRow(1).alignment = { horizontal: 'center', vertical: 'center' };

    // Add data rows
    items.forEach(item => {
      const toBuy = item.to_buy || item.toBuy || 0;
      const unitCost = item.cost_price || item.unitCost || 0;
      const totalCost = toBuy * unitCost;

      sheet.addRow({
        sku_code: item.sku_code || item.skuCode || '',
        supplier: item.supplier || item.supplierResolved || '',
        product_name: item.product_name || item.productName || '',
        total_needed: item.total_needed || 0,
        available: item.available || 0,
        to_buy: toBuy,
        unit_cost: unitCost,
        total_cost: totalCost
      });
    });

    // Format currency columns
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        row.getCell(7).numFmt = '$#,##0.00'; // Unit Cost
        row.getCell(8).numFmt = '$#,##0.00'; // Total Cost
      }
    });

    // Generate Excel buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // Validate ZIP signature (XLSX is a ZIP container)
    if (!buffer || buffer.length < 100 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      // "PK" signature missing - invalid XLSX
      return Response.json({
        ok: false,
        error: 'XLSX buffer validation failed - missing ZIP signature'
      }, { status: 500 });
    }

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName || 'purchase-requests.xlsx'}"`,
        'Content-Length': buffer.length.toString()
      }
    });

  } catch (error) {
    console.error('Excel export error:', error);
    return Response.json({
      error: error.message,
      details: error.stack
    }, { status: 500 });
  }
});