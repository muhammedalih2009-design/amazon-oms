import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';

export default function OrdersExporter({ orders, orderLines, filteredOrders, skus, stores = [] }) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    
    try {
      // Small delay to show loading state
      await new Promise(resolve => setTimeout(resolve, 100));

      // Prepare data rows - expand each order into multiple rows (one per order line)
      const rows = [];
      
      filteredOrders.forEach(order => {
        const lines = orderLines.filter(l => l.order_id === order.id);
        
        if (lines.length === 0) {
          // Order with no lines - export order info only
          rows.push({
            'Store': order.store_name || 'N/A',
            'Amazon Order ID': order.amazon_order_id || '',
            'Order Date': order.order_date ? format(new Date(order.order_date), 'yyyy-MM-dd') : '',
            'Status': order.status || '',
            'SKU Code': '',
            'Product Name': '',
            'Quantity': '',
            'Unit Cost': '',
            'Line Total Cost': '',
            'Order Revenue': order.net_revenue || 0,
            'Order Total Cost': order.total_cost || 0,
            'Order Profit': order.profit_loss || 0
          });
        } else {
          // Expand order into multiple rows (one per line)
          lines.forEach(line => {
            const sku = skus.find(s => s.id === line.sku_id);
            rows.push({
              'Store': order.store_name || 'N/A',
              'Amazon Order ID': order.amazon_order_id || '',
              'Order Date': order.order_date ? format(new Date(order.order_date), 'yyyy-MM-dd') : '',
              'Status': order.status || '',
              'SKU Code': line.sku_code || '',
              'Product Name': sku?.product_name || '',
              'Quantity': line.quantity || 0,
              'Unit Cost': line.unit_cost ? line.unit_cost.toFixed(2) : '',
              'Line Total Cost': line.line_total_cost ? line.line_total_cost.toFixed(2) : '',
              'Order Revenue': order.net_revenue || 0,
              'Order Total Cost': order.total_cost || 0,
              'Order Profit': order.profit_loss || 0
            });
          });
        }
      });

      // Create workbook and worksheet
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);

      // Set column widths for better readability
      ws['!cols'] = [
        { wch: 15 }, // Store
        { wch: 22 }, // Amazon Order ID
        { wch: 12 }, // Order Date
        { wch: 12 }, // Status
        { wch: 15 }, // SKU Code
        { wch: 30 }, // Product Name
        { wch: 10 }, // Quantity
        { wch: 12 }, // Unit Cost
        { wch: 15 }, // Line Total Cost
        { wch: 15 }, // Order Revenue
        { wch: 15 }, // Order Total Cost
        { wch: 15 }  // Order Profit
      ];

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(wb, ws, 'Orders');

      // Generate filename with current date
      const filename = `orders_export_${format(new Date(), 'yyyy-MM-dd_HHmmss')}.xlsx`;

      // Write file (with proper UTF-8 encoding for Arabic)
      XLSX.writeFile(wb, filename, { bookType: 'xlsx', type: 'binary' });

    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button
      onClick={handleExport}
      disabled={exporting || filteredOrders.length === 0}
      variant="outline"
      className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
    >
      {exporting ? (
        <>
          <div className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mr-2" />
          Preparing...
        </>
      ) : (
        <>
          <Download className="w-4 h-4 mr-2" />
          Export ({filteredOrders.length})
        </>
      )}
    </Button>
  );
}