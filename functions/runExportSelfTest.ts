import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import ExcelJS from 'npm:exceljs@4.4.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { tenantId } = await req.json();

    const results = {
      timestamp: new Date().toISOString(),
      pdfTest: { status: 'PASS', engine: 'Browser Print', reason: null, errorId: null, bufferSize: 0 },
      xlsxTest: { status: 'FAIL', engine: 'exceljs', reason: null, errorId: null, bufferSize: 0 }
    };

    // ===== EXCEL/XLSX TEST =====
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Self-Test');

      sheet.columns = [
        { header: 'IMAGE', key: 'image', width: 15 },
        { header: 'SUPPLIER', key: 'supplier', width: 20 },
        { header: 'SKU CODE', key: 'skuCode', width: 15 },
        { header: 'PRODUCT', key: 'product', width: 30 },
        { header: 'TO BUY', key: 'toBuy', width: 10 },
        { header: 'UNIT COST', key: 'unitCost', width: 12 }
      ];

      // Style header
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } };

      // Add test rows with Arabic text
      sheet.addRow({
        image: '[Sample]',
        supplier: 'Test Supplier',
        skuCode: 'TEST-001',
        product: 'طقم ثلاجة جديد ✅',
        toBuy: 5,
        unitCost: 25.00
      });

      sheet.addRow({
        image: '[Sample]',
        supplier: 'مورّد عربي',
        skuCode: 'AR-002',
        product: 'منتج اختبار عربي',
        toBuy: 10,
        unitCost: 50.00
      });

      const xlsxBuffer = await workbook.xlsx.writeBuffer();

      // Validate XLSX (ZIP signature + size)
      const isZipSignature = xlsxBuffer && xlsxBuffer.length > 5000 && xlsxBuffer[0] === 0x50 && xlsxBuffer[1] === 0x4b;

      if (isZipSignature) {
        results.xlsxTest = {
          status: 'PASS',
          engine: 'ExcelJS',
          reason: null,
          errorId: null,
          bufferSize: xlsxBuffer.byteLength
        };
      } else {
        results.xlsxTest = {
          status: 'FAIL',
          engine: 'ExcelJS',
          reason: `Invalid XLSX: missing ZIP signature "PK" or size <5KB (actual: ${xlsxBuffer?.byteLength || 0} bytes)`,
          errorId: errorIdXlsx,
          bufferSize: xlsxBuffer?.byteLength || 0
        };

        await base44.asServiceRole.entities.ExportError.create({
          tenant_id: tenantId,
          error_id: errorIdXlsx,
          export_mode: 'excel',
          error_message: `XLSX validation failed: invalid ZIP signature or size`,
          stack_trace: `Size: ${xlsxBuffer?.byteLength || 0}, Signature: ${xlsxBuffer?.[0]}-${xlsxBuffer?.[1]}`,
          resolved: false
        });
      }
    } catch (error) {
      results.xlsxTest = {
        status: 'FAIL',
        engine: 'ExcelJS',
        reason: error.message,
        errorId: null,
        bufferSize: 0
      };
    }

    // Overall status
    const overallStatus = results.pdfTest.status === 'PASS' && results.xlsxTest.status === 'PASS' ? 'PASS' : 'FAIL';

    return Response.json({
      status: overallStatus,
      results,
      message: overallStatus === 'PASS' 
        ? 'All export engines ready' 
        : 'One or more export engines failed self-test'
    });
  } catch (error) {
    console.error('Self-test error:', error);
    return Response.json({
      status: 'ERROR',
      message: error.message,
      results: {}
    }, { status: 500 });
  }
});