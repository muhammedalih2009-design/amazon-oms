import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import puppeteer from 'npm:puppeteer@22.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { htmlContent, filename, exportMode } = await req.json();

    if (!htmlContent) {
      return Response.json({ error: 'Missing htmlContent' }, { status: 400 });
    }

    // Launch Chromium browser
    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ]
    });

    try {
      const page = await browser.newPage();
      
      // Set viewport and user agent
      await page.setViewport({ width: 1200, height: 800 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

      // Set HTML content with embedded styles and font
      const htmlWithFonts = `
        <!DOCTYPE html>
        <html lang="ar">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <link href="https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;700&display=swap" rel="stylesheet">
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            
            body {
              font-family: 'Noto Naskh Arabic', 'Arial Unicode MS', Arial, sans-serif;
              font-size: 12px;
              line-height: 1.4;
              color: #000;
              background: #fff;
              padding: 20px;
            }

            .header {
              margin-bottom: 20px;
              border-bottom: 2px solid #4f46e5;
              padding-bottom: 15px;
            }

            .header h1 {
              font-size: 24px;
              font-weight: 700;
              margin-bottom: 5px;
              color: #1f2937;
            }

            .header-meta {
              display: flex;
              justify-content: space-between;
              font-size: 11px;
              color: #6b7280;
            }

            .supplier-section {
              margin-bottom: 30px;
              page-break-inside: avoid;
            }

            .supplier-header {
              background: #4f46e5;
              color: white;
              padding: 12px 15px;
              margin-bottom: 15px;
              font-weight: 700;
              border-radius: 4px;
              font-size: 13px;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 15px;
              font-size: 11px;
            }

            thead {
              background: #f3f4f6;
              border-top: 1px solid #d1d5db;
              border-bottom: 2px solid #4f46e5;
            }

            th {
              padding: 10px 8px;
              text-align: center;
              font-weight: 700;
              color: #1f2937;
              border-right: 1px solid #d1d5db;
            }

            th:last-child {
              border-right: none;
            }

            td {
              padding: 10px 8px;
              border-bottom: 1px solid #e5e7eb;
              border-right: 1px solid #e5e7eb;
              text-align: center;
            }

            td:last-child {
              border-right: none;
            }

            tbody tr:hover {
              background: #f9fafb;
            }

            .img-cell {
              text-align: center;
              width: 60px;
            }

            .img-cell img {
              max-width: 50px;
              max-height: 50px;
              object-fit: contain;
              display: block;
              margin: 0 auto;
            }

            .supplier-cell {
              text-align: left;
              font-weight: 500;
            }

            .product-cell {
              direction: rtl;
              unicode-bidi: plaintext;
              text-align: right;
              padding: 10px 12px;
              word-wrap: break-word;
              white-space: normal;
            }

            .number-cell {
              text-align: center;
              font-weight: 500;
            }

            .price-cell {
              text-align: right;
              font-family: 'Courier New', monospace;
            }

            .debug-cell {
              font-size: 9px;
              color: #6b7280;
              text-align: center;
            }

            .totals {
              display: flex;
              justify-content: flex-end;
              gap: 30px;
              margin-bottom: 20px;
              padding: 10px 15px;
              background: #f9fafb;
              border-radius: 4px;
              font-weight: 600;
            }

            .totals-label {
              min-width: 150px;
              text-align: right;
            }

            .footer {
              margin-top: 30px;
              padding-top: 15px;
              border-top: 1px solid #d1d5db;
              text-align: center;
              font-size: 10px;
              color: #6b7280;
            }

            .grand-total {
              background: #eef2ff;
              padding: 15px;
              margin-top: 20px;
              border-left: 4px solid #4f46e5;
              font-weight: 700;
              font-size: 13px;
              text-align: right;
            }

            @media print {
              body {
                padding: 0;
              }
              .supplier-section {
                page-break-inside: avoid;
              }
            }
          </style>
        </head>
        <body>
          ${htmlContent}
        </body>
        </html>
      `;

      await page.setContent(htmlWithFonts, { waitUntil: 'networkidle2' });

      // Wait for fonts to load
      await page.evaluateHandle('document.fonts.ready');

      // Generate PDF
      const pdfBuffer = await page.pdf({
        format: 'A4',
        margin: {
          top: 10,
          bottom: 10,
          left: 10,
          right: 10
        },
        printBackground: true,
        preferCSSPageSize: true
      });

      await page.close();

      return new Response(pdfBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename || 'purchase-request.pdf'}"`
        }
      });

    } finally {
      await browser.close();
    }

  } catch (error) {
    console.error('PDF generation error:', error);
    return Response.json({ 
      error: error.message,
      details: error.stack 
    }, { status: 500 });
  }
});