import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { format, parseISO, isWithinInterval } from 'date-fns';
import { ClipboardList, ShoppingCart, Check, Calculator, FileDown } from 'lucide-react';
import RefreshButton from '@/components/shared/RefreshButton';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import bidi from 'bidi-js';
import JSZip from 'jszip';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon } from 'lucide-react';
import DataTable from '@/components/shared/DataTable';
import PaywallBanner from '@/components/ui/PaywallBanner';
import { useToast } from '@/components/ui/use-toast';

export default function PurchaseRequests() {
  const { tenantId, subscription, isActive } = useTenant();
  const { toast } = useToast();
  const [orders, setOrders] = useState([]);
  const [orderLines, setOrderLines] = useState([]);
  const [skus, setSkus] = useState([]);
  const [currentStock, setCurrentStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSkus, setSelectedSkus] = useState([]);
  const [dateRange, setDateRange] = useState({
    from: new Date(),
    to: new Date(new Date().setDate(new Date().getDate() + 7))
  });
  const [exportMode, setExportMode] = useState('single'); // 'single' or 'per-supplier'

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
    const [ordersData, linesData, skusData, stockData] = await Promise.all([
      base44.entities.Order.filter({ tenant_id: tenantId }),
      base44.entities.OrderLine.filter({ tenant_id: tenantId }),
      base44.entities.SKU.filter({ tenant_id: tenantId }),
      base44.entities.CurrentStock.filter({ tenant_id: tenantId })
    ]);
    setOrders(ordersData);
    setOrderLines(linesData);
    setSkus(skusData);
    setCurrentStock(stockData);
    if (isRefresh) {
      setRefreshing(false);
    } else {
      setLoading(false);
    }
  };

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

    // Calculate to buy
    return Object.entries(skuNeeds).map(([skuId, needed]) => {
      const sku = skus.find(s => s.id === skuId);
      const stock = currentStock.find(s => s.sku_id === skuId);
      const available = stock?.quantity_available || 0;
      const toBuy = Math.max(0, needed - available);

      return {
        id: skuId,
        sku_id: skuId,
        sku_code: sku?.sku_code || 'Unknown',
        product_name: sku?.product_name || 'Unknown',
        cost_price: sku?.cost_price || 0,
        supplier_id: sku?.supplier_id,
        total_needed: needed,
        available,
        to_buy: toBuy
      };
    }).filter(item => item.to_buy > 0);
  }, [orders, orderLines, skus, currentStock, dateRange]);

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

  const handleExportToPDF = async () => {
    if (selectedSkus.length === 0) {
      toast({ title: 'No items selected', description: 'Please select SKUs to export', variant: 'destructive' });
      return;
    }

    const loadingToast = toast({ title: 'Generating PDF...', description: 'Loading data and preparing export' });

    try {
      // Safe formatter
      const safePDFText = (value, fieldName = 'unknown') => {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string') return value;
        if (typeof value === 'number') return value.toString();
        if (typeof value === 'boolean') return value.toString();
        if (Array.isArray(value)) return value.join(', ');
        if (typeof value === 'object') {
          console.warn(`⚠️ PDF object in "${fieldName}":`, value);
          return value.name || value.title || value.supplier_name || value.product_name || value.sku_code || JSON.stringify(value);
        }
        return String(value);
      };

      // Arabic text processing with proper RTL
      const processArabicText = (text) => {
        const safeText = String(safePDFText(text) || '');
        if (!safeText) return '';
        if (/[\u0600-\u06FF]/.test(safeText)) {
          return bidi(safeText);
        }
        return safeText;
      };

      // Get data
      const selectedItems = purchaseNeeds.filter(p => selectedSkus.includes(p.sku_id));
      const suppliersData = await base44.entities.Supplier.filter({ tenant_id: tenantId });
      const skusData = await base44.entities.SKU.filter({ tenant_id: tenantId });
      const tenantData = await base44.entities.Tenant.filter({ id: tenantId });
      const workspaceName = tenantData[0]?.name || 'Workspace';

      // Prepare items
      const itemsWithSupplier = selectedItems.map(item => {
        const supplier = suppliersData.find(s => s.id === item.supplier_id);
        const supplierName = safePDFText(supplier?.supplier_name || supplier?.name) || 'Unassigned';
        const productName = safePDFText(item.product_name);
        const skuCode = safePDFText(item.sku_code);
        const needed = safePDFText(item.total_needed);
        const available = safePDFText(item.available);
        const toBuy = safePDFText(item.to_buy);
        const costPrice = typeof item.cost_price === 'number' ? item.cost_price : 0;
        const unitCost = `$${costPrice.toFixed(2)}`;
        const estTotal = item.to_buy * costPrice;
        
        return {
          supplierName,
          supplierId: supplier?.id || 'unassigned',
          productName,
          skuCode,
          needed,
          available,
          toBuy,
          unitCost,
          estTotal,
          costPrice
        };
      });

      // Group by supplier
      const groupedBySupplier = itemsWithSupplier.reduce((acc, item) => {
        if (!acc[item.supplierName]) acc[item.supplierName] = [];
        acc[item.supplierName].push(item);
        return acc;
      }, {});

      const supplierNames = Object.keys(groupedBySupplier).sort((a, b) => {
        if (a === 'Unassigned') return 1;
        if (b === 'Unassigned') return -1;
        return a.localeCompare(b);
      });

      // Generate PDFs based on mode
      if (exportMode === 'per-supplier') {
        // Separate PDF per supplier
        const zip = new JSZip();
        const dateStr = format(new Date(), 'yyyy-MM-dd');

        for (const supplierName of supplierNames) {
          const items = groupedBySupplier[supplierName];
          const doc = new jsPDF();
          const pageWidth = doc.internal.pageSize.getWidth();

          // Header
          doc.setFontSize(20);
          doc.setFont('helvetica', 'bold');
          doc.text('Amazon OMS', 15, 20);
          
          doc.setFontSize(16);
          doc.text('Purchase Order Request', 15, 28);
          
          doc.setFontSize(12);
          doc.text(`Supplier: ${supplierName}`, 15, 36);
          
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          doc.text(`Workspace: ${workspaceName}`, 15, 44);
          doc.text(`Date: ${format(new Date(), 'MMM d, yyyy')}`, pageWidth - 15, 20, { align: 'right' });
          
          if (dateRange?.from && dateRange?.to) {
            doc.text(
              `Period: ${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d, yyyy')}`,
              pageWidth - 15,
              28,
              { align: 'right' }
            );
          }

          // Table headers - matching app columns
          const headers = ['SKU CODE', 'PRODUCT', 'NEEDED', 'IN STOCK', 'TO BUY', 'UNIT COST', 'EST. TOTAL'];

          const tableRows = items.map(item => [
            String(item.skuCode),
            String(processArabicText(item.productName)),
            String(item.needed),
            String(item.available),
            String(item.toBuy),
            String(item.unitCost),
            String(`$${item.estTotal.toFixed(2)}`)
          ]);

          doc.autoTable({
            startY: 52,
            head: [headers],
            body: tableRows,
            theme: 'grid',
            headStyles: {
              fillColor: [79, 70, 229],
              textColor: 255,
              fontSize: 10,
              fontStyle: 'bold',
              halign: 'center',
              cellPadding: { top: 5, bottom: 5 }
            },
            styles: {
              fontSize: 9,
              cellPadding: { top: 8, bottom: 8, left: 4, right: 4 },
              halign: 'center',
              lineColor: [200, 200, 200],
              lineWidth: 0.5,
              minCellHeight: 20
            },
            columnStyles: {
              0: { cellWidth: 22, halign: 'center' },
              1: { cellWidth: 50, halign: 'left' },
              2: { cellWidth: 18, halign: 'center' },
              3: { cellWidth: 20, halign: 'center' },
              4: { cellWidth: 18, halign: 'center' },
              5: { cellWidth: 24, halign: 'right' },
              6: { cellWidth: 28, halign: 'right' }
            }
          });

          // Totals
          const supplierTotal = items.reduce((sum, item) => sum + item.estTotal, 0);
          const supplierItemCount = items.reduce((sum, item) => sum + parseInt(item.toBuy), 0);
          
          const finalY = doc.lastAutoTable.finalY + 10;
          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          doc.text(`Total Items: ${supplierItemCount}`, pageWidth - 15, finalY, { align: 'right' });
          doc.text(`Total Cost: $${supplierTotal.toFixed(2)}`, pageWidth - 15, finalY + 7, { align: 'right' });

          // Add to ZIP
          const pdfBlob = doc.output('blob');
          zip.file(`PO_Request_${supplierName.replace(/[^a-z0-9]/gi, '_')}_${dateStr}.pdf`, pdfBlob);
        }

        // Download ZIP
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(zipBlob);
        link.download = `Purchase_Orders_${format(new Date(), 'yyyy-MM-dd')}.zip`;
        link.click();
        
        toast({ 
          title: 'PDFs Generated', 
          description: `${supplierNames.length} supplier PDFs downloaded as ZIP`,
          duration: 3000
        });

      } else {
        // Single PDF with page breaks per supplier
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();

        // Main header (first page only)
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.text('Amazon OMS', 15, 20);
        
        doc.setFontSize(16);
        doc.text('Purchase Order Request', 15, 28);
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(`Workspace: ${workspaceName}`, 15, 36);
        doc.text(`Date: ${format(new Date(), 'MMM d, yyyy')}`, pageWidth - 15, 20, { align: 'right' });
        
        if (dateRange?.from && dateRange?.to) {
          doc.text(
            `Period: ${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d, yyyy')}`,
            pageWidth - 15,
            28,
            { align: 'right' }
          );
        }

        const headers = ['SKU CODE', 'PRODUCT', 'NEEDED', 'IN STOCK', 'TO BUY', 'UNIT COST', 'EST. TOTAL'];

        let isFirstSupplier = true;
        for (const supplierName of supplierNames) {
          const items = groupedBySupplier[supplierName];
          
          // Add page break for each supplier (except first)
          if (!isFirstSupplier) {
            doc.addPage();
          }
          isFirstSupplier = false;

          // Supplier header
          const startY = doc.lastAutoTable ? 20 : 44;
          doc.setFontSize(14);
          doc.setFont('helvetica', 'bold');
          doc.setFillColor(79, 70, 229);
          doc.setTextColor(255, 255, 255);
          doc.rect(15, startY, pageWidth - 30, 10, 'F');
          
          const supplierTotal = items.reduce((sum, item) => sum + item.estTotal, 0);
          const supplierItemCount = items.reduce((sum, item) => sum + parseInt(item.toBuy), 0);
          
          doc.text(
            `Supplier: ${supplierName} • ${items.length} SKUs • ${supplierItemCount} items • $${supplierTotal.toFixed(2)}`,
            pageWidth / 2,
            startY + 7,
            { align: 'center' }
          );
          doc.setTextColor(0, 0, 0);

          // Table
          const tableRows = items.map(item => [
            String(item.skuCode),
            String(processArabicText(item.productName)),
            String(item.needed),
            String(item.available),
            String(item.toBuy),
            String(item.unitCost),
            String(`$${item.estTotal.toFixed(2)}`)
          ]);

          doc.autoTable({
            startY: startY + 12,
            head: [headers],
            body: tableRows,
            theme: 'grid',
            headStyles: {
              fillColor: [99, 102, 241],
              textColor: 255,
              fontSize: 10,
              fontStyle: 'bold',
              halign: 'center',
              cellPadding: { top: 5, bottom: 5 }
            },
            styles: {
              fontSize: 9,
              cellPadding: { top: 8, bottom: 8, left: 4, right: 4 },
              halign: 'center',
              lineColor: [200, 200, 200],
              lineWidth: 0.5,
              minCellHeight: 20
            },
            columnStyles: {
              0: { cellWidth: 22, halign: 'center' },
              1: { cellWidth: 50, halign: 'left' },
              2: { cellWidth: 18, halign: 'center' },
              3: { cellWidth: 20, halign: 'center' },
              4: { cellWidth: 18, halign: 'center' },
              5: { cellWidth: 24, halign: 'right' },
              6: { cellWidth: 28, halign: 'right' }
            }
          });
        }

        // Grand total on last page
        const grandTotal = itemsWithSupplier.reduce((sum, item) => sum + item.estTotal, 0);
        const grandTotalItems = itemsWithSupplier.reduce((sum, item) => sum + parseInt(item.toBuy), 0);

        const finalY = doc.lastAutoTable.finalY + 12;
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(`GRAND TOTAL: ${grandTotalItems} items • $${grandTotal.toFixed(2)}`, pageWidth - 15, finalY, { align: 'right' });

        // Save
        doc.save(`Purchase_Order_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
        
        toast({ 
          title: 'PDF Generated', 
          description: `${supplierNames.length} suppliers grouped successfully`,
          duration: 3000
        });
      }

    } catch (error) {
      console.error('❌ PDF generation failed:', error);
      toast({ 
        title: 'Export failed', 
        description: `Error: ${error.message}. Check console for details.`,
        variant: 'destructive',
        duration: 5000
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
      render: (val) => <span className="font-medium text-slate-900">{val}</span>
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

  return (
    <div className="space-y-6">
      <PaywallBanner subscription={subscription} onUpgrade={() => {}} />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Purchase Requests</h1>
          <p className="text-slate-500">Calculate inventory needs for pending orders</p>
        </div>
        <RefreshButton onRefresh={() => loadData(true)} loading={refreshing} />
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
                onClick={handleExportToPDF}
                variant="outline"
                className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
              >
                <FileDown className="w-4 h-4 mr-2" />
                Export to PDF
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
}