import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import ExcelJS from 'npm:exceljs@4.4.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { tenantId } = body;

    if (!tenantId) {
      return Response.json({ error: 'Missing tenantId' }, { status: 400 });
    }

    // Create workbook with single test row
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Test Data');

    // Set column widths
    sheet.columns = [
      { header: 'IMAGE_URL', key: 'image_url', width: 15 },
      { header: 'SUPPLIER', key: 'supplier', width: 20 },
      { header: 'SKU CODE', key: 'sku_code', width: 15 },
      { header: 'PRODUCT', key: 'product_name', width: 30 },
      { header: 'TO BUY', key: 'to_buy', width: 10 },
      { header: 'UNIT COST', key: 'cost_price', width: 12 }
    ];

    // Style header row
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };

    // Add single test row with Arabic text
    sheet.addRow({
      image_url: '',
      supplier: 'Test Supplier',
      sku_code: 'TEST-001',
      product_name: 'اختبار المنتج - Test Product',
      to_buy: 5,
      cost_price: 25.50
    });

    // Format currency column
    sheet.getColumn('F').numFmt = '$#,##0.00';

    // Write to buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // Return as Excel file
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="Test_Purchase_Request.xlsx"',
        'Content-Length': buffer.length.toString()
      }
    });
  } catch (error) {
    console.error('Test XLSX generation failed:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});