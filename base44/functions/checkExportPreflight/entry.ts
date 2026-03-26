import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import ExcelJS from 'npm:exceljs@4.4.0';
import { v4 as uuid } from 'npm:uuid@9.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { items, tenantId } = await req.json();

    if (!items || !Array.isArray(items) || items.length === 0) {
      return Response.json({
        ok: false,
        errorId: null,
        reason: 'No items provided'
      }, { status: 400 });
    }

    const errorId = uuid();
    const checks = {
      sampleProductType: null,
      sampleSupplierType: null,
      hasArabicFont: false,
      chromiumAvailable: false,
      canWriteTemp: false,
      xlsxValid: false
    };

    // A) Data type check on first 5 rows
    const sampleSize = Math.min(5, items.length);
    let dataTypeOk = true;
    for (let i = 0; i < sampleSize; i++) {
      const item = items[i];
      const productType = typeof item.product_name;
      const supplierType = typeof (item.supplier || item.supplierResolved);

      checks.sampleProductType = productType;
      checks.sampleSupplierType = supplierType;

      if (productType !== 'string' || supplierType !== 'string') {
        dataTypeOk = false;
        break;
      }
    }

    if (!dataTypeOk) {
      // Log error
      await base44.asServiceRole.entities.ExportError.create({
        tenant_id: tenantId,
        error_id: errorId,
        export_mode: 'preflight',
        error_message: 'Data mapping not resolved - product or supplier is not a string',
        stack_trace: JSON.stringify(checks),
        item_count: items.length,
        resolved: false
      });

      return Response.json({
        ok: false,
        errorId,
        reason: 'Data types invalid (product/supplier not strings)',
        checks
      });
    }

    // B) PDF engine checks
    let chromiumAvailable = false;
    try {
      // Try to launch Chromium headless with timeout
      const testProcess = Deno.run({
        cmd: ['which', 'chromium'],
        stdout: 'piped',
        stderr: 'piped'
      });
      const status = await testProcess.status();
      chromiumAvailable = status.success;
    } catch (e) {
      chromiumAvailable = false;
    }

    checks.chromiumAvailable = chromiumAvailable;

    // C) XLSX engine check - create tiny workbook
    try {
      const testWorkbook = new ExcelJS.Workbook();
      const testSheet = testWorkbook.addWorksheet('Test');
      testSheet.columns = [
        { header: 'SKU', key: 'sku', width: 15 },
        { header: 'Product', key: 'product', width: 30 },
        { header: 'Qty', key: 'qty', width: 10 }
      ];
      testSheet.addRow({ sku: 'TEST001', product: 'اختبار', qty: 1 });

      const testBuffer = await testWorkbook.xlsx.writeBuffer();

      // Validate ZIP signature
      const isValidXlsx =
        testBuffer &&
        testBuffer.length > 100 &&
        testBuffer[0] === 0x50 &&
        testBuffer[1] === 0x4b; // "PK"

      checks.xlsxValid = isValidXlsx;

      if (!isValidXlsx) {
        throw new Error('XLSX buffer missing ZIP signature');
      }
    } catch (e) {
      checks.xlsxValid = false;

      await base44.asServiceRole.entities.ExportError.create({
        tenant_id: tenantId,
        error_id: errorId,
        export_mode: 'preflight',
        error_message: `XLSX engine check failed: ${e.message}`,
        stack_trace: e.stack,
        item_count: items.length,
        resolved: false
      });

      return Response.json({
        ok: false,
        errorId,
        reason: 'XLSX engine not ready',
        checks
      });
    }

    // D) Temp write check
    try {
      const testFile = `/tmp/test_${errorId}.txt`;
      await Deno.writeTextFile(testFile, 'test');
      await Deno.remove(testFile);
      checks.canWriteTemp = true;
    } catch (e) {
      checks.canWriteTemp = false;
    }

    // All checks passed
    return Response.json({
      ok: true,
      errorId: null,
      engine: chromiumAvailable ? 'puppeteer' : 'jspdf',
      pdfReady: chromiumAvailable,
      xlsxReady: checks.xlsxValid,
      checks
    });
  } catch (error) {
    console.error('Preflight check error:', error);
    return Response.json({
      ok: false,
      errorId: null,
      reason: error.message,
      checks: {}
    }, { status: 500 });
  }
});