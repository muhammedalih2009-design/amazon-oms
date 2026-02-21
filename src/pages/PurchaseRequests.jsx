import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { format, parseISO, isWithinInterval } from 'date-fns';
import { createPageUrl } from '@/utils';
import { ClipboardList, ShoppingCart, Check, Calculator, FileDown, Loader, CheckCircle2, AlertCircle, Send } from 'lucide-react';
import RefreshButton from '@/components/shared/RefreshButton';
import ErrorBoundary from '@/components/shared/ErrorBoundary';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon } from 'lucide-react';
import DataTable from '@/components/shared/DataTable';
import PaywallBanner from '@/components/ui/PaywallBanner';
import TelegramExportModal from '@/components/purchases/TelegramExportModal';
import { useToast } from '@/components/ui/use-toast';

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
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [debugMode, setDebugMode] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [preparingPrint, setPreparingPrint] = useState(false);
  const [telegramConfigured, setTelegramConfigured] = useState(false);
  const [checkingTelegram, setCheckingTelegram] = useState(true);
  const [telegramModalOpen, setTelegramModalOpen] = useState(false);

  useEffect(() => {
    if (tenantId) loadData();
  }, [tenantId]);

  useEffect(() => {
    checkTelegramConfig();
  }, []);

  const checkTelegramConfig = async () => {
    try {
      const { data } = await base44.functions.invoke('checkTelegramConfig', {});
      setTelegramConfigured(data.configured);
    } catch (error) {
      setTelegramConfigured(false);
    } finally {
      setCheckingTelegram(false);
    }
  };



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

      // Normalize image URL
      const rawImageUrl = sku?.image_url || '';
      const normalizedImageUrl = rawImageUrl && 
                                 rawImageUrl !== 'null' && 
                                 rawImageUrl !== 'undefined' && 
                                 rawImageUrl.trim().length > 5 
                                   ? rawImageUrl.trim() 
                                   : '';

      return {
        id: skuId,
        sku_id: skuId,
        sku_code: sku?.sku_code || 'Unknown',
        product_name: sku?.product_name || 'Unknown',
        cost_price: sku?.cost_price || 0,
        image_url: normalizedImageUrl,
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

    toast({
      title: 'CSV Exported',
      description: `${selectedItems.length} items (sorted by supplier)`,
      duration: 3000
    });
  };

  const handlePrintPDF = async (mode) => {
    if (selectedSkus.length === 0) {
      toast({ title: 'No items selected', description: 'Please select SKUs to export', variant: 'destructive' });
      return;
    }

    setPreparingPrint(true);

    try {
      const selectedItems = purchaseNeeds.filter(p => selectedSkus.includes(p.sku_id));
      
      // Sort by supplier, then SKU
      const sorted = [...selectedItems].sort((a, b) => {
        const sa = (a.supplier || 'Unassigned').toString().trim().toLowerCase();
        const sb = (b.supplier || 'Unassigned').toString().trim().toLowerCase();
        const cmp = sa.localeCompare(sb, 'en', { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        return (a.sku_code || '').localeCompare(b.sku_code || '', 'en', { sensitivity: 'base' });
      });

      const rows = sorted.map(r => ({
        imageUrl: r.image_url || '',
        supplier: r.supplier || 'Unassigned',
        sku: r.sku_code || '',
        product: r.product_name || '',
        toBuy: Number(r.to_buy || 0),
        unitCost: Number(r.cost_price || 0)
      }));

      // Create print job in backend for reliable cross-window access
      const response = await base44.functions.invoke('createPrintJob', {
        tenantId,
        mode,
        dateRange: { 
          from: dateRange.from?.toISOString(), 
          to: dateRange.to?.toISOString() 
        },
        rows
      });

      const jobId = response.data.jobId;

      // Fallback: also store in sessionStorage for backward compatibility
      sessionStorage.setItem('pr_print_payload', JSON.stringify({
        mode,
        dateRange: { 
          from: dateRange.from?.toISOString(), 
          to: dateRange.to?.toISOString() 
        },
        rows,
        generatedAt: new Date().toISOString()
      }));

      const printWindow = window.open(
        createPageUrl(`PurchaseRequestsPrint?jobId=${jobId}&mode=${mode}`), 
        '_blank', 
        'noopener,noreferrer'
      );

      if (!printWindow) {
        toast({ 
          title: 'Popup Blocked', 
          description: 'Please allow popups for this site to open print view', 
          variant: 'destructive' 
        });
      }
    } catch (error) {
      toast({ 
        title: 'Print Preparation Failed', 
        description: error.message, 
        variant: 'destructive' 
      });
    } finally {
      setPreparingPrint(false);
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
      const firstBytes = String.fromCharCode(header[0], header[1]);
      
      if (firstBytes !== 'PK') {
        throw new Error('Invalid Excel file format (invalid ZIP signature)');
      }

      const link = document.createElement('a');
      link.href = URL.createObjectURL(excelBlob);
      link.download = `Purchase_Requests_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
      link.click();
      URL.revokeObjectURL(link.href);



      toast({
        title: 'Excel Exported ✓',
        description: `${sorted.length} items (sorted by supplier)`,
        duration: 3000
      });
    } catch (error) {
      console.error('Excel export failed:', error);
      

      
      toast({
        title: 'Excel Export Unavailable',
        description: 'Using CSV export instead',
        variant: 'default',
        duration: 4000
      });
      
      // Auto-fallback to CSV
      setTimeout(() => handleExportToCSV(), 500);
    } finally {
      setExportingExcel(false);
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
        <div className="flex gap-3 items-center">
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
          <div className="flex items-center gap-2">
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline">
                  <CalendarIcon className="w-4 h-4 mr-2" />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, 'MMM d')} - {format(dateRange.to, 'MMM d, yyyy')}
                      </>
                    ) : (
                      <span className="text-amber-600">Select end date: {format(dateRange.from, 'MMM d, yyyy')}</span>
                    )
                  ) : (
                    'Pick dates'
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-4" align="end" onPointerDownOutside={(e) => {
                // Only allow outside close if both dates are selected
                if (!dateRange?.to) {
                  e.preventDefault();
                }
              }}>
                <div className="space-y-3">
                  <Calendar
                    mode="range"
                    selected={dateRange}
                    onSelect={(range) => {
                      setDateRange(range);
                      // Keep calendar open - don't close on date selection
                    }}
                    month={calendarMonth}
                    onMonthChange={setCalendarMonth}
                    numberOfMonths={2}
                    disabled={false}
                    defaultMonth={calendarMonth}
                  />
                  <Button
                    onClick={() => {
                      if (dateRange?.from && dateRange?.to) {
                        setCalendarOpen(false);
                      }
                    }}
                    disabled={!dateRange?.from || !dateRange?.to}
                    className="w-full"
                  >
                    Done
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => {
                const now = new Date();
                const week = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
                setDateRange({ from: now, to: week });
                setCalendarOpen(false);
              }}
              className="text-slate-600 hover:text-slate-900"
            >
              Reset
            </Button>
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
          {!telegramConfigured && !checkingTelegram && (
            <div className="text-xs text-amber-700 bg-amber-50 px-3 py-1.5 rounded-md border border-amber-200">
              Telegram not configured. Go to Settings → Integrations → Telegram
            </div>
          )}

          {telegramConfigured && (
            <Button 
              onClick={() => setTelegramModalOpen(true)}
              variant="outline"
              className="border-blue-200 text-blue-700 hover:bg-blue-50"
              title="Send to Telegram with photos and captions"
            >
              <Send className="w-4 h-4 mr-2" />
              Telegram
            </Button>
          )}

          <Button 
            onClick={handleExportToCSV}
            variant="outline"
            className="border-sky-200 text-sky-700 hover:bg-sky-50"
            title="Export selected items to CSV, sorted by supplier"
          >
            <FileDown className="w-4 h-4 mr-2" />
            CSV
          </Button>

          <Button 
            onClick={() => handlePrintPDF('single')}
            variant="outline"
            className="border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
            disabled={preparingPrint}
            title="Print all items as one document"
          >
            {preparingPrint ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                <FileDown className="w-4 h-4 mr-2" />
                PDF (All)
              </>
            )}
          </Button>

          <Button 
            onClick={() => handlePrintPDF('supplier')}
            variant="outline"
            className="border-purple-200 text-purple-700 hover:bg-purple-50 disabled:opacity-50"
            disabled={preparingPrint}
            title="Print with page break per supplier"
          >
            {preparingPrint ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                <FileDown className="w-4 h-4 mr-2" />
                PDF (Supplier Pages)
              </>
            )}
          </Button>

          <Button 
            onClick={handleExportToExcel}
            variant="outline"
            className="border-green-200 text-green-700 hover:bg-green-50 disabled:opacity-50"
            disabled={exportingExcel}
            title="Export selected items to Excel, sorted by supplier"
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
            onClick={handleAddToCart}
            className="bg-indigo-600 hover:bg-indigo-700"
            disabled={!isActive}
          >
            <ShoppingCart className="w-4 h-4 mr-2" />
            Add to Purchase Cart
          </Button>
        </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setDebugMode(!debugMode)}
              variant={debugMode ? 'default' : 'outline'}
              size="sm"
              className={`text-xs ${debugMode ? 'bg-red-600 hover:bg-red-700' : 'border-red-200 text-red-700 hover:bg-red-50'}`}
            >
              {debugMode ? '🐛 Debug ON' : 'Debug'}
            </Button>
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

      {/* Telegram Export Modal */}
      <TelegramExportModal
        open={telegramModalOpen}
        onClose={() => setTelegramModalOpen(false)}
        tenantId={tenantId}
        items={purchaseNeeds.filter(p => selectedSkus.includes(p.sku_id))}
        dateRange={dateRange}
      />
    </div>
  );

  return (
    <ErrorBoundary fallbackTitle="Purchase Requests failed to load">
      <PurchaseRequestsContent />
    </ErrorBoundary>
  );
}