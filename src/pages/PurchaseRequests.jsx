import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { format, parseISO, isWithinInterval } from 'date-fns';
import { ClipboardList, ShoppingCart, Check, Calculator, FileDown, Loader } from 'lucide-react';
import RefreshButton from '@/components/shared/RefreshButton';
import ErrorBoundary from '@/components/shared/ErrorBoundary';
import ExportStatusModal from '@/components/exports/ExportStatusModal';
import JSZip from 'jszip';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon } from 'lucide-react';
import DataTable from '@/components/shared/DataTable';
import PaywallBanner from '@/components/ui/PaywallBanner';
import { useToast } from '@/components/ui/use-toast';
import ExportSelfTestPanel from '@/components/exports/ExportSelfTestPanel';

export default function PurchaseRequests() {
  const { tenantId, subscription, isActive, user } = useTenant();
  const { toast } = useToast();
  const [orders, setOrders] = useState([]);
  const [orderLines, setOrderLines] = useState([]);
  const [skus, setSkus] = useState([]);
  const [currentStock, setCurrentStock] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSkus, setSelectedSkus] = useState([]);
  const [dateRange, setDateRange] = useState({
    from: new Date(),
    to: new Date(new Date().setDate(new Date().getDate() + 7))
  });
  const [exportMode, setExportMode] = useState('single'); // 'single' or 'per-supplier'
  const [debugMode, setDebugMode] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [selfTestResults, setSelfTestResults] = useState(null);
  const [selfTestLoading, setSelfTestLoading] = useState(false);
  const [exportProofs, setExportProofs] = useState(null);
  const [exportStatusOpen, setExportStatusOpen] = useState(false);

  useEffect(() => {
    if (tenantId) loadData();
  }, [tenantId]);

  // Real-time stock updates
  useEffect(() => {
    if (!tenantId) return;
    
    const unsubscribe = base44.entities.CurrentStock.subscribe((event) => {
      if (event.type === 'update') {
        setCurrentStock(prev => prev.map(s => 
          s.id === event.id ? event.data : s
        ));
      } else if (event.type === 'create') {
        setCurrentStock(prev => [...prev, event.data]);
      } else if (event.type === 'delete') {
        setCurrentStock(prev => prev.filter(s => s.id !== event.id));
      }
    });

    return unsubscribe;
  }, [tenantId]);

  const loadData = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    const [ordersData, linesData, skusData, stockData, suppliersData] = await Promise.all([
      base44.entities.Order.filter({ tenant_id: tenantId }),
      base44.entities.OrderLine.filter({ tenant_id: tenantId }),
      base44.entities.SKU.filter({ tenant_id: tenantId }),
      base44.entities.CurrentStock.filter({ tenant_id: tenantId }),
      base44.entities.Supplier.filter({ tenant_id: tenantId })
    ]);
    setOrders(ordersData);
    setOrderLines(linesData);
    setSkus(skusData);
    setCurrentStock(stockData);
    setSuppliers(suppliersData);
    if (isRefresh) {
      setRefreshing(false);
    } else {
      setLoading(false);
    }
  };

  // Normalize SKU for matching
  const normalizeSku = (sku) => {
    const t = (sku ?? '').toString().trim();
    return t
      .replace(/[\s\r\n]+/g, '')
      .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
      .replace(/[-_]+/g, '')
      .replace(/[^0-9A-Za-z]+/g, '')
      .toUpperCase();
  };

  // Build Master Data lookup map
  const masterLookup = useMemo(() => {
    const lookup = {};
    skus.forEach(md => {
      const mdKey = normalizeSku(md.sku_code || md.skuCode || md.sku || md['SKU CODE'] || md.SKU || '');
      if (mdKey) {
        lookup[mdKey] = md;
      }
    });
    return lookup;
  }, [skus]);

  // Auto-calculate needs when date range changes
  const purchaseNeeds = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return [];

    // Filter pending orders in date range
    const pendingOrders = orders.filter(o => {
      if (o.status !== 'pending') return false;
      if (!o.order_date) return true;
      const orderDate = parseISO(o.order_date);
      return isWithinInterval(orderDate, { start: dateRange.from, end: dateRange.to });
    });

    // Calculate total needed per SKU
    const skuNeeds = {};
    for (const order of pendingOrders) {
      const lines = orderLines.filter(l => l.order_id === order.id && !l.is_returned);
      for (const line of lines) {
        if (!skuNeeds[line.sku_id]) {
          skuNeeds[line.sku_id] = 0;
        }
        skuNeeds[line.sku_id] += line.quantity;
      }
    }

    // Calculate to buy and resolve supplier from Master Data
    return Object.entries(skuNeeds).map(([skuId, needed]) => {
      const sku = skus.find(s => s.id === skuId);
      const stock = currentStock.find(s => s.sku_id === skuId);
      const available = stock?.quantity_available || 0;
      const toBuy = Math.max(0, needed - available);

      // Resolve supplier from Master Data
      const skuKey = normalizeSku(sku?.sku_code || '');
      const md = masterLookup[skuKey];
      
      let supplierResolved = '';
      if (md?.supplier_id) {
        const supplierEntity = suppliers.find(s => s.id === md.supplier_id);
        if (supplierEntity) {
          supplierResolved = (supplierEntity.supplier_name || supplierEntity.name || '').toString().trim();
        }
      }
      
      if (!supplierResolved) {
        supplierResolved = (md?.supplier || md?.vendor || md?.Supplier || md?.brandSupplier || md?.vendorName || '').toString().trim()
          || (sku?.supplier || '').toString().trim()
          || 'Unassigned';
      }

      return {
        id: skuId,
        sku_id: skuId,
        sku_code: sku?.sku_code || 'Unknown',
        product_name: sku?.product_name || 'Unknown',
        cost_price: sku?.cost_price || 0,
        supplier_id: sku?.supplier_id,
        supplier: supplierResolved,
        total_needed: needed,
        available,
        to_buy: toBuy,
        _debugSkuKey: skuKey,
        _debugMdMatch: !!md
      };
    }).filter(item => item.to_buy > 0);
  }, [orders, orderLines, skus, currentStock, suppliers, dateRange, masterLookup]);

  const handleSelectAll = () => {
    if (selectedSkus.length === purchaseNeeds.length) {
      setSelectedSkus([]);
    } else {
      setSelectedSkus(purchaseNeeds.map(p => p.sku_id));
    }
  };

  const handleToggleSelect = (skuId) => {
    if (selectedSkus.includes(skuId)) {
      setSelectedSkus(selectedSkus.filter(id => id !== skuId));
    } else {
      setSelectedSkus([...selectedSkus, skuId]);
    }
  };

  const handleRunSelfTest = async () => {
    setSelfTestLoading(true);
    try {
      const response = await base44.functions.invoke('runExportSelfTest', {
        tenantId
      });
      setSelfTestResults(response.data.results);
      toast({
        title: response.data.status === 'PASS' ? 'All engines ready' : 'Engine test failed',
        description: response.data.message,
        variant: response.data.status === 'PASS' ? 'default' : 'destructive'
      });
    } catch (error) {
      toast({
        title: 'Self-test error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSelfTestLoading(false);
    }
  };

  const handleExportToCSV = () => {
    if (selectedSkus.length === 0) {
      toast({ title: 'No items selected', description: 'Please select SKUs to export', variant: 'destructive' });
      return;
    }

    const selectedItems = purchaseNeeds.filter(p => selectedSkus.includes(p.sku_id));

    // Sort by supplier, then by SKU code
    const sorted = [...selectedItems].sort((a, b) => {
      const sa = (a.supplier || 'Unassigned').toString().trim().toLowerCase();
      const sb = (b.supplier || 'Unassigned').toString().trim().toLowerCase();
      const cmp = sa.localeCompare(sb, 'en', { sensitivity: 'base' });
      if (cmp !== 0) return cmp;
      // Stable sort by SKU code within same supplier
      return (a.sku_code || '').localeCompare(b.sku_code || '', 'en', { sensitivity: 'base' });
    });

    // Build CSV with UTF-8 BOM for Excel
    const csvHeader = 'IMAGE_URL,SUPPLIER,SKU CODE,PRODUCT,TO BUY,UNIT COST\n';
    
    const csvRows = sorted.map(item => {
      const imageUrl = '';
      const supplier = (item.supplier || '').replace(/"/g, '""');
      const skuCode = (item.sku_code || '').replace(/"/g, '""');
      const product = (item.product_name || '').replace(/"/g, '""');
      const toBuy = item.to_buy || 0;
      const unitCost = (item.cost_price || 0).toFixed(2);

      return `"${imageUrl}","${supplier}","${skuCode}","${product}",${toBuy},${unitCost}`;
    }).join('\n');

    const csvContent = '\uFEFF' + csvHeader + csvRows;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Purchase_Requests_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);

    // Record proof for admin modal
    setExportProofs(prev => ({
      ...prev,
      csvSort: {
        status: 'pass',
        preview: sorted.slice(0, 10).map(item => ({
          supplier: item.supplier || 'Unassigned',
          sku_code: item.sku_code
        }))
      },
      noBlocking: {
        status: 'pass',
        data: {
          csvAllowed: true,
          pdfPrintAllowed: true,
          excelFallback: false
        }
      }
    }));

    toast({
      title: 'CSV Exported',
      description: `${selectedItems.length} items (sorted by supplier)`,
      duration: 3000
    });
  };

  const handleExportPrintPDF = () => {
    if (selectedSkus.length === 0) {
      toast({ title: 'No items selected', description: 'Please select SKUs to export', variant: 'destructive' });
      return;
    }

    const selectedItems = purchaseNeeds.filter(p => selectedSkus.includes(p.sku_id));
    
    // Sort by supplier first
    const sorted = [...selectedItems].sort((a, b) => {
      const sa = (a.supplier || 'Unassigned').toString().trim().toLowerCase();
      const sb = (b.supplier || 'Unassigned').toString().trim().toLowerCase();
      const cmp = sa.localeCompare(sb, 'en', { sensitivity: 'base' });
      if (cmp !== 0) return cmp;
      return (a.sku_code || '').localeCompare(b.sku_code || '', 'en', { sensitivity: 'base' });
    });

    // Get workspace name
    const workspaceName = tenant?.name || 'Workspace';
    const dateStr = format(new Date(), 'MMM d, yyyy');

    // Group items by supplier
    const groupedBySupplier = sorted.reduce((acc, item) => {
      const supplier = item.supplier || 'Unassigned';
      if (!acc[supplier]) acc[supplier] = [];
      acc[supplier].push(item);
      return acc;
    }, {});

    const supplierNames = Object.keys(groupedBySupplier).sort((a, b) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b, 'en', { sensitivity: 'base' });
    });

    // Build print HTML
    const tableRows = supplierNames.map((supplierName, supplierIndex) => {
      const items = groupedBySupplier[supplierName];
      const supplierTotal = items.reduce((sum, item) => sum + (item.to_buy * item.cost_price), 0);
      const supplierItemCount = items.reduce((sum, item) => sum + item.to_buy, 0);

      const itemRows = items.map(item => {
        const skuEntity = skus.find(s => s.id === item.sku_id);
        const imageUrl = skuEntity?.image_url || '';

        return `
          <tr class="item-row">
            <td class="image-cell">
              ${imageUrl ? `<img src="${imageUrl}" alt="SKU" class="item-image" />` : ''}
            </td>
            <td class="supplier-cell">${item.supplier || 'Unassigned'}</td>
            <td class="sku-cell">${item.sku_code || ''}</td>
            <td class="product-cell" dir="rtl">${item.product_name || ''}</td>
            <td class="number-cell">${item.to_buy || 0}</td>
            <td class="price-cell">$${(item.cost_price || 0).toFixed(2)}</td>
          </tr>
        `;
      }).join('');

      const supplierSection = `
        <div class="supplier-section ${supplierIndex > 0 ? 'page-break' : ''}">
          <div class="supplier-header">
            <strong>${supplierName}</strong>
            <span>${items.length} SKUs • ${supplierItemCount} items • $${supplierTotal.toFixed(2)}</span>
          </div>
          <table class="items-table">
            <thead>
              <tr class="header-row">
                <th class="image-header">IMAGE</th>
                <th class="supplier-header">SUPPLIER</th>
                <th class="sku-header">SKU CODE</th>
                <th class="product-header">PRODUCT</th>
                <th class="number-header">TO BUY</th>
                <th class="price-header">UNIT COST</th>
              </tr>
            </thead>
            <tbody>
              ${itemRows}
            </tbody>
          </table>
        </div>
      `;

      return supplierSection;
    }).join('');

    const printHTML = `
      <!DOCTYPE html>
      <html lang="ar">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Purchase Requests</title>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;700&display=swap" rel="stylesheet" />
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: "Noto Naskh Arabic", "Amiri", Arial, sans-serif;
            font-size: 11px;
            line-height: 1.4;
            color: #1f2937;
            background: white;
            padding: 20px;
          }

          .page-header {
            text-align: center;
            margin-bottom: 20px;
            border-bottom: 2px solid #e5e7eb;
            padding-bottom: 10px;
          }

          .page-header h1 {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 5px;
          }

          .header-meta {
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            color: #6b7280;
            margin-top: 5px;
          }

          .supplier-section {
            margin-bottom: 20px;
            page-break-inside: avoid;
          }

          .page-break {
            page-break-before: always;
          }

          .supplier-header {
            display: flex;
            justify-content: space-between;
            background: #f3f4f6;
            padding: 8px 12px;
            margin-bottom: 10px;
            font-weight: bold;
            font-size: 12px;
            border-radius: 4px;
          }

          .supplier-header strong {
            flex: 1;
          }

          .supplier-header span {
            text-align: right;
            font-weight: normal;
            font-size: 10px;
            color: #6b7280;
          }

          .items-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 15px;
          }

          .items-table thead {
            background: #e5e7eb;
            font-weight: bold;
            font-size: 10px;
          }

          .items-table th {
            padding: 6px 8px;
            text-align: left;
            border: 1px solid #d1d5db;
          }

          .image-header {
            width: 110px;
            text-align: center;
          }

          .supplier-header {
            width: 100px;
          }

          .sku-header {
            width: 90px;
          }

          .product-header {
            flex: 1;
            min-width: 150px;
          }

          .number-header {
            width: 60px;
            text-align: center;
          }

          .price-header {
            width: 80px;
            text-align: right;
          }

          .item-row {
            border-bottom: 1px solid #e5e7eb;
            page-break-inside: avoid;
          }

          .item-row:hover {
            background: #f9fafb;
          }

          .image-cell {
            padding: 6px;
            text-align: center;
            width: 110px;
            height: 110px;
          }

          .item-image {
            max-width: 100px;
            max-height: 100px;
            object-fit: contain;
          }

          .supplier-cell {
            padding: 6px 8px;
            width: 100px;
            font-size: 10px;
          }

          .sku-cell {
            padding: 6px 8px;
            width: 90px;
            font-size: 10px;
            font-weight: 600;
          }

          .product-cell {
            padding: 6px 8px;
            flex: 1;
            min-width: 150px;
            direction: rtl;
            unicode-bidi: plaintext;
            text-align: right;
            font-size: 11px;
          }

          .number-cell {
            padding: 6px 8px;
            width: 60px;
            text-align: center;
            font-weight: bold;
            color: #4f46e5;
          }

          .price-cell {
            padding: 6px 8px;
            width: 80px;
            text-align: right;
            font-size: 10px;
          }

          @media print {
            body {
              padding: 10px;
            }

            .page-header {
              margin-bottom: 15px;
              padding-bottom: 8px;
            }

            .supplier-section {
              margin-bottom: 15px;
            }

            .item-row:hover {
              background: white;
            }

            .page-break {
              page-break-before: always;
            }

            .supplier-section {
              page-break-inside: avoid;
            }
          }

          @page {
            margin: 0.5in;
            size: A4;
          }
        </style>
      </head>
      <body>
        <div class="page-header">
          <h1>Purchase Requests</h1>
          <div class="header-meta">
            <div><strong>Workspace:</strong> ${workspaceName}</div>
            <div><strong>Date:</strong> ${dateStr}</div>
          </div>
        </div>
        ${tableRows}
      </body>
      </html>
    `;

    // Open print window
    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!printWindow) {
      toast({
        title: 'Popup Blocked',
        description: 'Please allow popups to export PDF',
        variant: 'destructive'
      });
      return;
    }

    printWindow.document.write(printHTML);
    printWindow.document.close();

    // Trigger print after rendering
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 500);

    toast({
      title: 'Print Dialog Opened',
      description: 'Click "Print" to save as PDF',
      duration: 4000
    });
  };

  const handleAddToCart = async () => {
    if (selectedSkus.length === 0) {
      toast({ title: 'Select at least one SKU', variant: 'destructive' });
      return;
    }

    // Clear existing cart
    const existingCart = await base44.entities.PurchaseCart.filter({ tenant_id: tenantId });
    for (const item of existingCart) {
      await base44.entities.PurchaseCart.delete(item.id);
    }

    // Add selected items to cart
    for (const skuId of selectedSkus) {
      const need = purchaseNeeds.find(p => p.sku_id === skuId);
      if (need) {
        await base44.entities.PurchaseCart.create({
          tenant_id: tenantId,
          sku_id: skuId,
          sku_code: need.sku_code,
          product_name: need.product_name,
          quantity_needed: need.to_buy,
          suggested_supplier_id: need.supplier_id
        });
      }
    }

    toast({ 
      title: 'Added to Purchase Cart', 
      description: `${selectedSkus.length} items added. Go to Purchases to complete.` 
    });
    setSelectedSkus([]);
  };

  const totalValue = purchaseNeeds.reduce((sum, p) => sum + (p.to_buy * p.cost_price), 0);
  const totalItems = purchaseNeeds.reduce((sum, p) => sum + p.to_buy, 0);

  // Export to Excel
  const handleExportToExcel = async () => {
    if (selectedSkus.length === 0) {
      toast({ title: 'No items selected', description: 'Please select SKUs to export', variant: 'destructive' });
      return;
    }

    setExportingExcel(true);
    toast({ title: 'Generating Excel...', description: 'Preparing file' });

    try {
      const selectedItems = purchaseNeeds.filter(p => selectedSkus.includes(p.sku_id));
      
      // Sort by supplier
      const sorted = [...selectedItems].sort((a, b) => {
        const sa = (a.supplier || 'Unassigned').toString().trim().toLowerCase();
        const sb = (b.supplier || 'Unassigned').toString().trim().toLowerCase();
        const cmp = sa.localeCompare(sb, 'en', { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        return (a.sku_code || '').localeCompare(b.sku_code || '', 'en', { sensitivity: 'base' });
      });

      const response = await base44.functions.invoke('exportToExcel', {
        items: sorted,
        fileName: `Purchase_Requests_${format(new Date(), 'yyyy-MM-dd')}.xlsx`
      });

      // Validate response
      if (response.data && response.data.ok === false) {
        throw new Error(response.data.error || 'Excel generation failed');
      }

      // Handle binary response
      let excelBlob;
      if (response.data instanceof Blob) {
        excelBlob = response.data;
      } else if (response.data instanceof ArrayBuffer) {
        excelBlob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      } else {
        excelBlob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      }

      // Validate ZIP signature
      const header = new Uint8Array(await excelBlob.slice(0, 2).arrayBuffer());
      if (header[0] !== 0x50 || header[1] !== 0x4b) {
        throw new Error('Invalid Excel file format (invalid ZIP signature)');
      }

      const link = document.createElement('a');
      link.href = URL.createObjectURL(excelBlob);
      link.download = `Purchase_Requests_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
      link.click();
      URL.revokeObjectURL(link.href);

      toast({
        title: 'Excel Exported',
        description: `${sorted.length} items (sorted by supplier)`,
        duration: 3000
      });
    } catch (error) {
      console.error('Excel export failed:', error);
      toast({
        title: 'Excel Export Unavailable',
        description: 'Please use CSV export instead',
        variant: 'destructive',
        duration: 4000
      });
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportToPDF = async () => {
    if (selectedSkus.length === 0) {
      toast({ title: 'No items selected', description: 'Please select SKUs to export', variant: 'destructive' });
      return;
    }

    // Hard gate: Check self-test results first
    if (selfTestResults && selfTestResults.pdfTest.status !== 'PASS') {
      toast({
        title: 'PDF Engine Failed Self-Test',
        description: `${selfTestResults.pdfTest.reason}. Run self-test to fix (Error ID: ${selfTestResults.pdfTest.errorId})`,
        variant: 'destructive',
        duration: 6000
      });
      return;
    }

    if (!selfTestResults) {
      toast({
        title: 'Run Export Self-Test First',
        description: 'Click "Run Export Self-Test" to validate engines before exporting',
        variant: 'destructive'
      });
      return;
    }

    // Step 2: Proceed with PDF export
    toast({ title: 'Generating PDF...', description: 'Loading Master Data and preparing export' });

    try {
      // Safe text converter - ensures only strings/numbers, never objects
      const toStr = (value) => {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        if (typeof value === 'object') {
          return value.name || value.title || value.productName || value.nameAr || value.nameEN || value.arName || value.enName || '';
        }
        return String(value);
      };

      // AGGRESSIVE SKU normalization (remove spaces, RTL marks, hyphens, underscores, non-alphanumeric)
      const normalizeSku = (sku) => {
        const t = (sku ?? '').toString().trim();
        return t
          .replace(/[\s\r\n]+/g, '')
          .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
          .replace(/[-_]+/g, '')
          .replace(/[^0-9A-Za-z]+/g, '')
          .toUpperCase();
      };

      // Build HTML table for Chromium PDF rendering
      const buildTableHTML = (items, supplierName) => {
        const rows = items.map(item => `
          <tr>
            <td class="img-cell">${item.image ? `<img src="${item.image}" />` : ''}</td>
            <td class="supplier-cell">${item.supplier}</td>
            <td>${item.skuCode}</td>
            <td class="product-cell">${item.productName}</td>
            <td class="number-cell">${item.toBuy}</td>
            <td class="price-cell">$${item.unitCost.toFixed(2)}</td>
            ${debugMode ? `<td class="debug-cell">${item._debugSkuKey}</td><td class="debug-cell">${item._debugMdMatch ? 'YES' : 'NO'}</td>` : ''}
          </tr>
        `).join('');

        const headers = debugMode 
          ? ['IMAGE', 'SUPPLIER', 'SKU CODE', 'PRODUCT', 'TO BUY', 'UNIT COST', 'SKU_KEY', 'MD_MATCH']
          : ['IMAGE', 'SUPPLIER', 'SKU CODE', 'PRODUCT', 'TO BUY', 'UNIT COST'];

        return `
          <table>
            <thead>
              <tr>
                ${headers.map(h => `<th>${h}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        `;
      };

      // Load image as base64 with larger canvas
      const loadImageAsBase64 = (url) => {
        return new Promise((resolve) => {
          if (!url) {
            resolve(null);
            return;
          }
          const img = new Image();
          img.crossOrigin = 'Anonymous';
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = 80;
              canvas.height = 80;
              const ctx = canvas.getContext('2d');
              
              // Calculate aspect fit
              const aspectRatio = img.width / img.height;
              let drawWidth = 80;
              let drawHeight = 80;
              let offsetX = 0;
              let offsetY = 0;
              
              if (aspectRatio > 1) {
                drawHeight = 80 / aspectRatio;
                offsetY = (80 - drawHeight) / 2;
              } else {
                drawWidth = 80 * aspectRatio;
                offsetX = (80 - drawWidth) / 2;
              }
              
              ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
              resolve(canvas.toDataURL('image/jpeg', 0.8));
            } catch (e) {
              console.warn('Image conversion failed:', e);
              resolve(null);
            }
          };
          img.onerror = () => resolve(null);
          img.src = url;
        });
      };

      // Get Master Data (SKU entities) and other data
      const selectedItems = purchaseNeeds.filter(p => selectedSkus.includes(p.sku_id));
      const masterData = await base44.entities.SKU.filter({ tenant_id: tenantId });
      const suppliersData = await base44.entities.Supplier.filter({ tenant_id: tenantId });
      const tenantData = await base44.entities.Tenant.filter({ id: tenantId });
      const workspaceName = toStr(tenantData[0]?.name || 'Workspace');

      // Build Master Data lookup by normalized SKU
      const masterLookup = {};
      masterData.forEach(md => {
        const mdSkuKey = normalizeSku(md.sku_code || md.skuCode || md.sku || md['SKU CODE'] || md.itemSku || md.SKU || '');
        if (mdSkuKey) {
          masterLookup[mdSkuKey] = md;
        }
      });

      console.log('📊 Master Data lookup built:', Object.keys(masterLookup).length, 'SKUs indexed');
      if (debugMode) {
        console.log('🔍 DEBUG: First 5 master keys:', Object.keys(masterLookup).slice(0, 5));
      }

      let failedImagesCount = 0;

      // Use UI-resolved data directly (no re-joining, no re-mapping)
      const itemsWithData = await Promise.all(selectedItems.map(async (item) => {
        // Load image if available
        let imageData = null;
        const skuEntity = skus.find(s => s.id === item.sku_id);
        if (skuEntity?.image_url) {
          imageData = await loadImageAsBase64(skuEntity.image_url);
          if (!imageData) failedImagesCount++;
        }
        
        // Use UI-resolved values (already correct strings from purchaseNeeds)
        const supplierResolved = String(item.supplier || 'Unassigned');
        let productResolved = String(item.product_name || 'Unknown Product');
        
        // Safety check: ensure product is never an object
        if (typeof productResolved !== 'string') {
          productResolved = String(productResolved);
        }
        
        return {
          image: imageData,
          supplier: supplierResolved,
          skuCode: String(item.sku_code || ''),
          productName: productResolved,
          toBuy: Number(item.to_buy || 0),
          unitCost: Number(item.cost_price || 0),
          // Debug fields (pass through from UI)
          _debugSkuKey: item._debugSkuKey || '',
          _debugMdMatch: item._debugMdMatch || false
        };
      }));

      // Sort by supplier (Unassigned last)
      itemsWithData.sort((a, b) => {
        if (a.supplier === 'Unassigned') return 1;
        if (b.supplier === 'Unassigned') return -1;
        return (a.supplier || '').localeCompare(b.supplier || '', 'en', { sensitivity: 'base' });
      });

      console.log('✅ Enriched items:', itemsWithData.length, 'rows prepared');
      console.log('Sample row:', itemsWithData[0]);
      
      // Debug: Log first product to verify it's a string
      if (itemsWithData.length > 0) {
        const firstProduct = itemsWithData[0].productName;
        console.log('🔍 DEBUG First Product:', {
          value: firstProduct,
          type: typeof firstProduct,
          isString: typeof firstProduct === 'string',
          length: firstProduct?.length
        });
      }

      // Group by supplier
      const groupedBySupplier = itemsWithData.reduce((acc, item) => {
        if (!acc[item.supplier]) acc[item.supplier] = [];
        acc[item.supplier].push(item);
        return acc;
      }, {});

      const supplierNames = Object.keys(groupedBySupplier).sort((a, b) => {
        if (a === 'Unassigned') return 1;
        if (b === 'Unassigned') return -1;
        return a.localeCompare(b, 'ar', { sensitivity: 'base' });
      });

      // Headers (add debug columns if in debug mode)
      const headers = debugMode 
        ? ['IMAGE', 'SUPPLIER', 'SKU CODE', 'PRODUCT', 'TO BUY', 'UNIT COST', 'SKU_KEY', 'MD_MATCH']
        : ['IMAGE', 'SUPPLIER', 'SKU CODE', 'PRODUCT', 'TO BUY', 'UNIT COST'];

      setExportingPDF(true);
      const dateStr = format(new Date(), 'yyyy-MM-dd');

      // Generate PDFs via Puppeteer backend with fallback
      if (exportMode === 'per-supplier') {
        const zip = new JSZip();
        let anyPdfFailed = false;

        for (const supplierName of supplierNames) {
          const items = groupedBySupplier[supplierName];
          const supplierTotal = items.reduce((sum, item) => sum + (item.to_buy * item.cost_price), 0);
          const supplierItemCount = items.reduce((sum, item) => sum + item.to_buy, 0);

          const htmlContent = `
            <div class="header">
              <h1>Purchase Request</h1>
              <div class="header-meta">
                <div>
                  <strong>Supplier:</strong> ${supplierName}<br/>
                  <strong>Workspace:</strong> ${workspaceName}
                </div>
                <div style="text-align: right;">
                  <strong>Date:</strong> ${format(new Date(), 'MMM d, yyyy')}<br/>
                  ${dateRange?.from && dateRange?.to ? `<strong>Period:</strong> ${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d, yyyy')}` : ''}
                </div>
              </div>
            </div>
            <div class="supplier-section">
              <div class="supplier-header">
                ${items.length} SKUs • ${supplierItemCount} items • $${supplierTotal.toFixed(2)}
              </div>
              ${buildTableHTML(items, supplierName)}
              <div class="totals">
                <div class="totals-label">Total Items: ${supplierItemCount}</div>
                <div class="totals-label">Total Cost: $${supplierTotal.toFixed(2)}</div>
              </div>
            </div>
          `;

          try {
            const response = await base44.functions.invoke('generatePurchaseRequestPDFWithFallback', {
              htmlContent,
              filename: `Purchase_Request_${supplierName.replace(/[^a-z0-9\u0600-\u06FF]/gi, '_')}_${dateStr}.pdf`,
              exportMode: 'pdf_per_supplier',
              tenantId,
              items: selectedItems
            });

            if (response.data.fallback) {
              anyPdfFailed = true;
            } else {
              const pdfBlob = new Blob([response.data], { type: 'application/pdf' });
              const safeFileName = supplierName.replace(/[^a-z0-9\u0600-\u06FF]/gi, '_');
              zip.file(`Purchase_Request_${safeFileName}_${dateStr}.pdf`, pdfBlob);
            }
          } catch (err) {
            anyPdfFailed = true;
          }
        }

        if (anyPdfFailed) {
          toast({
            title: 'PDF Generation Failed',
            description: 'Falling back to Excel export automatically',
            variant: 'destructive',
            duration: 4000
          });
          setTimeout(() => handleExportToExcel(true), 500);
        } else {
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          const link = document.createElement('a');
          link.href = URL.createObjectURL(zipBlob);
          link.download = `Purchase_Requests_${dateStr}.zip`;
          link.click();
          URL.revokeObjectURL(link.href);

          toast({
            title: 'PDFs Generated',
            description: `${supplierNames.length} suppliers • ${selectedItems.length} items`,
            duration: 4000
          });
        }

      } else {
        const sectionsHTML = supplierNames.map(supplierName => {
          const items = groupedBySupplier[supplierName];
          const supplierTotal = items.reduce((sum, item) => sum + (item.to_buy * item.cost_price), 0);
          const supplierItemCount = items.reduce((sum, item) => sum + item.to_buy, 0);

          return `
            <div class="supplier-section">
              <div class="supplier-header">
                ${supplierName} • ${items.length} SKUs • ${supplierItemCount} items • $${supplierTotal.toFixed(2)}
              </div>
              ${buildTableHTML(items, supplierName)}
            </div>
          `;
        }).join('');

        const htmlContent = `
          <div class="header">
            <h1>Purchase Requests</h1>
            <div class="header-meta">
              <div>
                <strong>Workspace:</strong> ${workspaceName}
              </div>
              <div style="text-align: right;">
                <strong>Date:</strong> ${format(new Date(), 'MMM d, yyyy')}<br/>
                ${dateRange?.from && dateRange?.to ? `<strong>Period:</strong> ${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d, yyyy')}` : ''}
              </div>
            </div>
          </div>
          ${sectionsHTML}
          <div class="grand-total">
            GRAND TOTAL: ${totalItems} items • $${totalValue.toFixed(2)}
          </div>
        `;

        try {
          const response = await base44.functions.invoke('generatePurchaseRequestPDFWithFallback', {
            htmlContent,
            filename: `Purchase_Requests_${dateStr}.pdf`,
            exportMode: 'pdf_single',
            tenantId,
            items: selectedItems
          });

          if (response.data && response.data.fallback) {
            const errorId = response.data.errorId;
            toast({
              title: 'PDF Generation Failed',
              description: `Falling back to Excel. Error ID: ${errorId}`,
              variant: 'destructive',
              duration: 5000
            });
            setTimeout(() => handleExportToExcel(true), 500);
          } else {
            const pdfBlob = new Blob([response.data], { type: 'application/pdf' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(pdfBlob);
            link.download = `Purchase_Requests_${dateStr}.pdf`;
            link.click();
            URL.revokeObjectURL(link.href);

            toast({
              title: 'PDF Generated Successfully',
              description: `${supplierNames.length} suppliers • ${selectedItems.length} items`,
              duration: 4000
            });
          }
        } catch (err) {
          console.error('PDF export error:', err);
          toast({
            title: 'PDF Export Failed',
            description: 'Falling back to Excel export',
            variant: 'destructive',
            duration: 4000
          });
          setTimeout(() => handleExportToExcel(true), 500);
        }
      }
      setExportingPDF(false);

    } catch (error) {
      console.error('❌ PDF export failed:', error);
      toast({ 
        title: 'Export Failed', 
        description: `${error.message}. See console for details.`,
        variant: 'destructive',
        duration: 6000
      });
    }
  };

  const columns = [
    {
      key: 'select',
      header: (
        <Checkbox
          checked={selectedSkus.length === purchaseNeeds.length && purchaseNeeds.length > 0}
          onCheckedChange={handleSelectAll}
        />
      ),
      render: (_, row) => (
        <Checkbox
          checked={selectedSkus.includes(row.sku_id)}
          onCheckedChange={() => handleToggleSelect(row.sku_id)}
        />
      )
    },
    {
      key: 'sku_code',
      header: 'SKU Code',
      sortable: true,
      render: (val, row) => (
        <div>
          <span className="font-medium text-slate-900">{val}</span>
          {debugMode && (
            <div className="text-xs text-slate-400 mt-1">
              Key: {row._debugSkuKey} • Match: {row._debugMdMatch ? '✅ YES' : '❌ NO'}
            </div>
          )}
        </div>
      )
    },
    {
      key: 'supplier',
      header: 'Supplier',
      sortable: true,
      render: (val) => (
        <span className={val === 'Unassigned' ? 'text-slate-400 italic' : 'text-slate-700'}>
          {val}
        </span>
      )
    },
    {
      key: 'product_name',
      header: 'Product',
      sortable: true
    },
    {
      key: 'total_needed',
      header: 'Needed',
      align: 'right',
      render: (val) => <span className="font-semibold text-amber-600">{val}</span>
    },
    {
      key: 'available',
      header: 'In Stock',
      align: 'right',
      render: (val) => <span className={val > 0 ? 'text-emerald-600' : 'text-slate-400'}>{val}</span>
    },
    {
      key: 'to_buy',
      header: 'To Buy',
      align: 'right',
      render: (val) => <span className="font-bold text-indigo-600">{val}</span>
    },
    {
      key: 'cost_price',
      header: 'Unit Cost',
      align: 'right',
      render: (val) => `$${(val || 0).toFixed(2)}`
    },
    {
      key: 'estimated_cost',
      header: 'Est. Total',
      align: 'right',
      render: (_, row) => (
        <span className="font-medium">${(row.to_buy * row.cost_price).toFixed(2)}</span>
      )
    }
  ];

  const PurchaseRequestsContent = () => (
    <div className="space-y-6">
      <PaywallBanner subscription={subscription} onUpgrade={() => {}} />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Purchase Requests</h1>
          <p className="text-slate-500">Calculate inventory needs for pending orders</p>
        </div>
        <div className="flex gap-3">
          {user?.role === 'admin' && (
            <ExportSelfTestPanel
              results={selfTestResults}
              loading={selfTestLoading}
              onRunTest={handleRunSelfTest}
            />
          )}
          <RefreshButton onRefresh={() => loadData(true)} loading={refreshing} />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl p-6 text-white">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-white/20 rounded-lg">
              <Calculator className="w-5 h-5" />
            </div>
            <span className="text-white/80">SKUs to Order</span>
          </div>
          <p className="text-3xl font-bold">{purchaseNeeds.length}</p>
        </div>

        <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl p-6 text-white">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-white/20 rounded-lg">
              <ClipboardList className="w-5 h-5" />
            </div>
            <span className="text-white/80">Total Items</span>
          </div>
          <p className="text-3xl font-bold">{totalItems}</p>
        </div>

        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-6 text-white">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-white/20 rounded-lg">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <span className="text-white/80">Estimated Cost</span>
          </div>
          <p className="text-3xl font-bold">${totalValue.toLocaleString()}</p>
        </div>
      </div>

      {/* Date Range Filter */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-slate-900">Order Date Range</h3>
            <p className="text-sm text-slate-500">Calculate needs for pending orders in this period</p>
          </div>
          <div className="flex items-center gap-4">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">
                  <CalendarIcon className="w-4 h-4 mr-2" />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, 'MMM d')} - {format(dateRange.to, 'MMM d, yyyy')}
                      </>
                    ) : (
                      format(dateRange.from, 'MMM d, yyyy')
                    )
                  ) : (
                    'Pick dates'
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>

      {/* Action Bar */}
      {selectedSkus.length > 0 && (
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-indigo-700 font-medium">
          {selectedSkus.length} SKU(s) selected
        </p>
        <div className="flex items-center gap-3">
          <Button 
            onClick={handleExportToCSV}
            variant="outline"
            className="border-sky-200 text-sky-700 hover:bg-sky-50"
            title="Sorted by supplier"
          >
            <FileDown className="w-4 h-4 mr-2" />
            CSV
          </Button>
          <Button 
            onClick={handleExportPrintPDF}
            variant="outline"
            className="border-purple-200 text-purple-700 hover:bg-purple-50"
            title="Open browser print dialog"
          >
            <FileDown className="w-4 h-4 mr-2" />
            PDF (Print)
          </Button>
          <Button 
            onClick={handleExportToExcel}
            variant="outline"
            className="border-green-200 text-green-700 hover:bg-green-50 disabled:opacity-50"
            disabled={exportingExcel || exportingPDF}
          >
            {exportingExcel ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" />
                Excel...
              </>
            ) : (
              <>
                <FileDown className="w-4 h-4 mr-2" />
                Excel
              </>
            )}
          </Button>
          <Button 
            onClick={handleExportToPDF}
            variant="outline"
            className="border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            disabled={exportingPDF || exportingExcel}
          >
            {exportingPDF ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" />
                PDF...
              </>
            ) : (
              <>
                <FileDown className="w-4 h-4 mr-2" />
                PDF
              </>
            )}
          </Button>
          <Button 
            onClick={handleAddToCart}
            className="bg-indigo-600 hover:bg-indigo-700"
            disabled={!isActive}
          >
            <ShoppingCart className="w-4 h-4 mr-2" />
            Add to Purchase Cart
          </Button>
        </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-600">Export mode:</span>
            <button
              onClick={() => setExportMode('single')}
              className={`px-3 py-1 rounded-md transition-colors ${
                exportMode === 'single'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-200'
              }`}
            >
              Single PDF (All)
            </button>
            <button
              onClick={() => setExportMode('per-supplier')}
              className={`px-3 py-1 rounded-md transition-colors ${
                exportMode === 'per-supplier'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-200'
              }`}
            >
              PDF per Supplier (ZIP)
            </button>
            <button
              onClick={() => setDebugMode(!debugMode)}
              className={`px-3 py-1 rounded-md transition-colors ${
                debugMode
                  ? 'bg-red-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-red-200'
              }`}
            >
              {debugMode ? '🐛 Debug ON' : 'Debug Mode'}
            </button>
          </div>
        </div>
      )}

      {/* Needs Table */}
      <DataTable
        columns={columns}
        data={purchaseNeeds}
        loading={loading}
        emptyIcon={ClipboardList}
        emptyTitle="No purchase needs"
        emptyDescription="All pending orders are covered by current stock"
      />
    </div>
  );

  return (
    <ErrorBoundary fallbackTitle="Purchase Requests failed to load">
      <PurchaseRequestsContent />
    </ErrorBoundary>
  );
}