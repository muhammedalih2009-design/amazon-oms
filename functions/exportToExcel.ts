import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import XLSX from 'npm:xlsx@0.18.5';

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

    // Transform items to Excel format
    const excelRows = items.map(item => ({
      'SKU Code': item.sku_code || item.skuCode || '',
      'Supplier': item.supplier || item.supplierResolved || '',
      'Product': item.product_name || item.productName || '',
      'Needed': item.total_needed || item.toBuy || 0,
      'In Stock': item.available || 0,
      'To Buy': item.to_buy || item.toBuy || 0,
      'Unit Cost': item.cost_price || item.unitCost || 0,
      'Total Cost': (item.to_buy || item.toBuy || 0) * (item.cost_price || item.unitCost || 0)
    }));

    // Create workbook
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(excelRows);

    // Set column widths
    worksheet['!cols'] = [
      { wch: 15 },  // SKU Code
      { wch: 20 },  // Supplier
      { wch: 30 },  // Product
      { wch: 10 },  // Needed
      { wch: 10 },  // In Stock
      { wch: 10 },  // To Buy
      { wch: 12 },  // Unit Cost
      { wch: 14 }   // Total Cost
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Purchase Requests');

    // Generate Excel file
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });

    return new Response(new Uint8Array(excelBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName || 'purchase-requests.xlsx'}"`
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