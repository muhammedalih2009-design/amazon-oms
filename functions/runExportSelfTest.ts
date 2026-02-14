import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import ExcelJS from 'npm:exceljs@4.4.0';
import { v4 as uuid } from 'npm:uuid@9.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { tenantId } = await req.json();

    const errorIdPdf = uuid();
    const errorIdXlsx = uuid();
    const results = {
      timestamp: new Date().toISOString(),
      pdfTest: { status: 'FAIL', engine: null, reason: null, errorId: null, bufferSize: 0 },
      xlsxTest: { status: 'FAIL', engine: 'exceljs', reason: null, errorId: null, bufferSize: 0 }
    };

    // ===== PDF TEST =====
    try {
      const pdfHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8" />
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #ccc; padding: 10px; text-align: left; }
            th { background-color: #f0f0f0; font-weight: bold; }
            .image-cell { text-align: center; }
          </style>
        </head>
        <body>
          <h1>PDF Export Self-Test</h1>
          <table>
            <thead>
              <tr>
                <th>IMAGE</th>
                <th>SUPPLIER</th>
                <th>SKU CODE</th>
                <th>PRODUCT</th>
                <th>TO BUY</th>
                <th>UNIT COST</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="image-cell">[Sample]</td>
                <td>Test Supplier</td>
                <td>TEST-001</td>
                <td>طقم ثلاجة جديد ✅</td>
                <td>5</td>
                <td>$25.00</td>
              </tr>
              <tr>
                <td class="image-cell">[Sample]</td>
                <td>مورّد عربي</td>
                <td>AR-002</td>
                <td>منتج اختبار عربي</td>
                <td>10</td>
                <td>$50.00</td>
              </tr>
            </tbody>
          </table>
          <p>Generated: ${new Date().toISOString()}</p>
        </body>
        </html>
      `;

      // Try Puppeteer/Chromium first
      let pdfBuffer = null;
      let pdfEngine = null;

      try {
        // Attempt Chromium
        const response = await fetch('http://localhost:3000/pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html: pdfHtml })
        }).catch(() => null);

        if (response && response.ok) {
          pdfBuffer = await response.arrayBuffer();
          pdfEngine = 'Chromium (Puppeteer)';
        }
      } catch (e) {
        pdfEngine = null;
      }

      // If Chromium failed, use jsPDF as fallback
      if (!pdfBuffer) {
        try {
          const { jsPDF } = await import('npm:jspdf@2.5.2');
          const doc = new jsPDF();
          doc.setFontSize(16);
          doc.text('PDF Export Self-Test', 20, 20);
          doc.setFontSize(11);
          doc.text('TABLE: IMAGE | SUPPLIER | SKU CODE | PRODUCT | TO BUY | UNIT COST', 20, 35);
          doc.text('Sample Row 1: Test Supplier | TEST-001 | طقم ثلاجة جديد ✅ | 5 | $25.00', 20, 50);
          doc.text('Sample Row 2: مورّد عربي | AR-002 | منتج اختبار عربي | 10 | $50.00', 20, 65);
          doc.text(`Generated: ${new Date().toISOString()}`, 20, 80);
          pdfBuffer = await doc.output('arraybuffer');
          pdfEngine = 'jsPDF';
        } catch (e) {
          results.pdfTest = {
            status: 'FAIL',
            engine: null,
            reason: `No PDF engine available: ${e.message}`,
            errorId: errorIdPdf,
            bufferSize: 0
          };
          
          await base44.asServiceRole.entities.ExportError.create({
            tenant_id: tenantId,
            error_id: errorIdPdf,
            export_mode: 'pdf_single',
            error_message: `PDF self-test failed: No engine available`,
            stack_trace: e.message,
            resolved: false
          });
        }
      }

      // Validate PDF
      if (pdfBuffer) {
        const pdfHeader = new Uint8Array(pdfBuffer.slice(0, 4));
        const headerStr = String.fromCharCode(...pdfHeader);
        const isPdfValid = headerStr === '%PDF' && pdfBuffer.byteLength > 20000;

        if (isPdfValid) {
          results.pdfTest = {
            status: 'PASS',
            engine: pdfEngine,
            reason: null,
            errorId: null,
            bufferSize: pdfBuffer.byteLength
          };
        } else {
          results.pdfTest = {
            status: 'FAIL',
            engine: pdfEngine,
            reason: `Invalid PDF: header="${headerStr}", size=${pdfBuffer.byteLength} bytes (expected >20KB)`,
            errorId: errorIdPdf,
            bufferSize: pdfBuffer.byteLength
          };

          await base44.asServiceRole.entities.ExportError.create({
            tenant_id: tenantId,
            error_id: errorIdPdf,
            export_mode: 'pdf_single',
            error_message: `PDF validation failed: invalid header or size`,
            stack_trace: `Header: ${headerStr}, Size: ${pdfBuffer.byteLength}`,
            resolved: false
          });
        }
      }
    } catch (error) {
      results.pdfTest = {
        status: 'FAIL',
        engine: null,
        reason: error.message,
        errorId: errorIdPdf,
        bufferSize: 0
      };

      await base44.asServiceRole.entities.ExportError.create({
        tenant_id: tenantId,
        error_id: errorIdPdf,
        export_mode: 'pdf_single',
        error_message: `PDF self-test exception: ${error.message}`,
        stack_trace: error.stack,
        resolved: false
      });
    }

    // ===== XLSX TEST =====
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
        errorId: errorIdXlsx,
        bufferSize: 0
      };

      await base44.asServiceRole.entities.ExportError.create({
        tenant_id: tenantId,
        error_id: errorIdXlsx,
        export_mode: 'excel',
        error_message: `XLSX self-test exception: ${error.message}`,
        stack_trace: error.stack,
        resolved: false
      });
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