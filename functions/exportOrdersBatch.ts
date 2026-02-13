import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Authenticate user
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse input
    const { workspace_id, batch_id } = await req.json();
    
    if (!workspace_id || !batch_id) {
      return Response.json({ 
        error: 'Missing required parameters: workspace_id and batch_id' 
      }, { status: 400 });
    }

    // Verify batch belongs to workspace
    const batches = await base44.entities.ImportBatch.filter({ 
      id: batch_id,
      tenant_id: workspace_id,
      batch_type: 'orders'
    });

    if (batches.length === 0) {
      return Response.json({ 
        error: 'Batch not found or access denied' 
      }, { status: 404 });
    }

    const batch = batches[0];

    // Fetch orders for this batch
    const orders = await base44.entities.Order.filter({ 
      tenant_id: workspace_id,
      import_batch_id: batch_id
    });

    if (orders.length === 0) {
      return Response.json({ 
        error: 'No orders found in this batch' 
      }, { status: 404 });
    }

    // Fetch order lines for all orders in batch
    const orderIds = orders.map(o => o.id);
    const allOrderLines = await base44.entities.OrderLine.filter({ 
      tenant_id: workspace_id
    });
    
    const orderLines = allOrderLines.filter(line => orderIds.includes(line.order_id));

    // Generate CSV matching upload structure
    const headers = ['amazon_order_id', 'order_date', 'sku_code', 'quantity'];
    const rows = [];

    // Expand each order into multiple rows (one per order line)
    orders.forEach(order => {
      const lines = orderLines.filter(l => l.order_id === order.id);
      lines.forEach(line => {
        rows.push([
          order.amazon_order_id || '',
          order.order_date || '',
          line.sku_code || '',
          line.quantity || ''
        ]);
      });
    });

    // Generate CSV with UTF-8 BOM for Excel compatibility
    const BOM = '\uFEFF';
    const escapeCsvCell = (value) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      const needsQuoting = str.includes(',') || str.includes('"') || str.includes('\n');
      if (needsQuoting) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvContent = BOM + [
      headers.map(h => escapeCsvCell(h)).join(','),
      ...rows.map(row => row.map(cell => escapeCsvCell(cell)).join(','))
    ].join('\n');

    // Return CSV file
    const filename = `orders_batch_${batch.display_name || batch.batch_name || batch.id}_${new Date().toISOString().split('T')[0]}.csv`;
    
    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv;charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    });

  } catch (error) {
    console.error('Export orders batch error:', error);
    return Response.json({ 
      error: error.message || 'Failed to export batch' 
    }, { status: 500 });
  }
});