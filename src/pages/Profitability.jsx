import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ChevronDown,
  ChevronRight,
  Upload,
  TrendingUp,
  Download,
  DollarSign,
  Package,
  AlertCircle
} from 'lucide-react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';

export default function ProfitabilityPage() {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [stores, setStores] = useState([]);
  const [expandedOrders, setExpandedOrders] = useState(new Set());
  const [uploading, setUploading] = useState(false);
  const [lastImport, setLastImport] = useState(null);
  
  // Filters
  const [storeFilter, setStoreFilter] = useState('all');
  const [matchFilter, setMatchFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    if (tenant?.id) {
      loadData();
    }
  }, [tenant?.id]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [ordersData, storesData, profLines, importBatches] = await Promise.all([
        base44.entities.Order.filter({ 
          tenant_id: tenant.id,
          status: 'fulfilled'
        }),
        base44.entities.Store.filter({ tenant_id: tenant.id }),
        base44.entities.ProfitabilityLine.filter({ tenant_id: tenant.id }),
        base44.entities.ProfitabilityImportBatch.filter({ tenant_id: tenant.id })
      ]);

      const [orderLines, skus] = await Promise.all([
        base44.entities.OrderLine.filter({ tenant_id: tenant.id }),
        base44.entities.SKU.filter({ tenant_id: tenant.id })
      ]);

      // Build maps
      const skuMap = {};
      skus.forEach(sku => { skuMap[sku.id] = sku; });

      const profLineMap = {};
      profLines.forEach(pl => {
        profLineMap[pl.order_line_id] = pl;
      });

      // Group order lines by order
      const orderLinesMap = {};
      orderLines.forEach(line => {
        if (!orderLinesMap[line.order_id]) {
          orderLinesMap[line.order_id] = [];
        }
        
        const profLine = profLineMap[line.id];
        const sku = skuMap[line.sku_id];
        const unitCost = line.unit_cost || sku?.cost_price || 0;
        const totalCost = unitCost * line.quantity;

        orderLinesMap[line.order_id].push({
          ...line,
          sku,
          unitCost,
          totalCost,
          revenue: profLine?.revenue || 0,
          profit: profLine?.profit || 0,
          marginPercent: profLine?.margin_percent || 0,
          matchStatus: profLine?.match_status || 'unmatched'
        });
      });

      // Enhance orders with line data
      const enhancedOrders = ordersData.map(order => {
        const lines = orderLinesMap[order.id] || [];
        const orderRevenue = lines.reduce((sum, l) => sum + (l.revenue || 0), 0);
        const orderCost = lines.reduce((sum, l) => sum + l.totalCost, 0);
        const orderProfit = orderRevenue - orderCost;
        const orderMargin = orderRevenue > 0 ? (orderProfit / orderRevenue) * 100 : 0;

        return {
          ...order,
          lines,
          orderRevenue,
          orderCost,
          orderProfit,
          orderMargin,
          hasRevenueData: lines.some(l => l.revenue > 0)
        };
      });

      setOrders(enhancedOrders);
      setStores(storesData);

      if (importBatches.length > 0) {
        const latest = importBatches.sort((a, b) => 
          new Date(b.created_date) - new Date(a.created_date)
        )[0];
        setLastImport(latest);
      }

    } catch (error) {
      toast({
        title: 'Failed to load data',
        description: error.message,
        variant: 'destructive'
      });
    }
    setLoading(false);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('tenantId', tenant.id);

      const response = await base44.functions.invoke('processProfitabilityImport', formData);

      if (response.data.success) {
        toast({
          title: 'Import completed',
          description: `Matched: ${response.data.matched}, Unmatched: ${response.data.unmatched}`
        });
        await loadData();
      } else {
        toast({
          title: 'Import failed',
          description: response.data.error || 'Unknown error',
          variant: 'destructive'
        });
      }
    } catch (error) {
      toast({
        title: 'Upload failed',
        description: error.message,
        variant: 'destructive'
      });
    }
    setUploading(false);
    e.target.value = '';
  };

  const exportUnmatched = () => {
    if (!lastImport?.unmatched_data) return;

    const unmatched = JSON.parse(lastImport.unmatched_data);
    const ws = XLSX.utils.json_to_sheet(unmatched);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Unmatched');
    XLSX.writeFile(wb, `profitability_unmatched_${format(new Date(), 'yyyyMMdd_HHmmss')}.xlsx`);
  };

  const toggleExpand = (orderId) => {
    const newExpanded = new Set(expandedOrders);
    if (newExpanded.has(orderId)) {
      newExpanded.delete(orderId);
    } else {
      newExpanded.add(orderId);
    }
    setExpandedOrders(newExpanded);
  };

  // Apply filters
  const filteredOrders = orders.filter(order => {
    if (storeFilter !== 'all' && order.store_id !== storeFilter) return false;
    
    if (matchFilter === 'matched' && !order.hasRevenueData) return false;
    if (matchFilter === 'unmatched' && order.hasRevenueData) return false;
    
    if (startDate && order.order_date < startDate) return false;
    if (endDate && order.order_date > endDate) return false;

    return true;
  });

  // Summary stats
  const totalRevenue = filteredOrders.reduce((sum, o) => sum + o.orderRevenue, 0);
  const totalCost = filteredOrders.reduce((sum, o) => sum + o.orderCost, 0);
  const totalProfit = totalRevenue - totalCost;
  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  if (loading) {
    return (
      <div className="p-6">
        <p>Loading profitability data...</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Profitability</h1>
          <p className="text-slate-600 mt-1">Line-level profit analysis for fulfilled orders</p>
        </div>
        <label htmlFor="revenue-upload">
          <Button asChild disabled={uploading}>
            <span>
              <Upload className="w-4 h-4 mr-2" />
              {uploading ? 'Uploading...' : 'Upload Revenue'}
            </span>
          </Button>
          <input
            id="revenue-upload"
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileUpload}
            className="hidden"
          />
        </label>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600">Total Revenue</p>
              <p className="text-2xl font-bold text-slate-900">${totalRevenue.toFixed(2)}</p>
            </div>
            <DollarSign className="w-10 h-10 text-green-500 opacity-20" />
          </div>
        </Card>
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600">Total Cost</p>
              <p className="text-2xl font-bold text-slate-900">${totalCost.toFixed(2)}</p>
            </div>
            <Package className="w-10 h-10 text-orange-500 opacity-20" />
          </div>
        </Card>
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600">Net Profit</p>
              <p className={`text-2xl font-bold ${totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                ${totalProfit.toFixed(2)}
              </p>
            </div>
            <TrendingUp className="w-10 h-10 text-blue-500 opacity-20" />
          </div>
        </Card>
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600">Avg Margin</p>
              <p className={`text-2xl font-bold ${avgMargin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {avgMargin.toFixed(1)}%
              </p>
            </div>
            <TrendingUp className="w-10 h-10 text-indigo-500 opacity-20" />
          </div>
        </Card>
      </div>

      {/* Last Import Summary */}
      {lastImport && (
        <Card className="p-4 bg-blue-50 border-blue-200">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-semibold text-blue-900">Last Import: {lastImport.file_name}</p>
              <div className="flex gap-4 mt-2 text-sm text-blue-700">
                <span>Total: {lastImport.total_rows}</span>
                <span className="text-green-700">Matched: {lastImport.matched_rows}</span>
                <span className="text-red-700">Unmatched: {lastImport.unmatched_rows}</span>
                {lastImport.qty_mismatch_rows > 0 && (
                  <span className="text-orange-700">Qty Mismatch: {lastImport.qty_mismatch_rows}</span>
                )}
              </div>
            </div>
            {lastImport.unmatched_rows > 0 && (
              <Button variant="outline" size="sm" onClick={exportUnmatched}>
                <Download className="w-4 h-4 mr-2" />
                Export Unmatched
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">Store</label>
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Stores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stores</SelectItem>
                {stores.map(store => (
                  <SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">Match Status</label>
            <Select value={matchFilter} onValueChange={setMatchFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Orders</SelectItem>
                <SelectItem value="matched">Matched (Has Revenue)</SelectItem>
                <SelectItem value="unmatched">Unmatched</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">Start Date</label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">End Date</label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
      </Card>

      {/* Orders Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Order ID</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Store</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Date</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-slate-900">Lines</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-slate-900">Cost</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-slate-900">Revenue</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-slate-900">Profit</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-slate-900">Margin</th>
                <th className="px-4 py-3 text-center text-sm font-semibold text-slate-900">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredOrders.map(order => {
                const isExpanded = expandedOrders.has(order.id);
                return (
                  <React.Fragment key={order.id}>
                    <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => toggleExpand(order.id)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-400" />
                          )}
                          <span className="font-medium text-slate-900">{order.amazon_order_id}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">{order.store_name}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {format(new Date(order.order_date), 'MMM d, yyyy')}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-900">{order.lines.length}</td>
                      <td className="px-4 py-3 text-right text-sm text-slate-900">${order.orderCost.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-sm font-medium text-slate-900">
                        ${order.orderRevenue.toFixed(2)}
                      </td>
                      <td className={`px-4 py-3 text-right text-sm font-medium ${order.orderProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        ${order.orderProfit.toFixed(2)}
                      </td>
                      <td className={`px-4 py-3 text-right text-sm font-medium ${order.orderMargin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {order.orderMargin.toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-center">
                        {order.hasRevenueData ? (
                          <Badge className="bg-green-100 text-green-800">Matched</Badge>
                        ) : (
                          <Badge variant="outline" className="text-slate-600">Unmatched</Badge>
                        )}
                      </td>
                    </tr>
                    
                    {/* Expanded Line Details */}
                    {isExpanded && (
                      <tr>
                        <td colSpan="9" className="bg-slate-50 px-4 py-4">
                          <div className="ml-8">
                            <table className="w-full">
                              <thead>
                                <tr className="border-b">
                                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">SKU</th>
                                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-700">Qty</th>
                                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-700">Unit Cost</th>
                                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-700">Total Cost</th>
                                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-700">Revenue</th>
                                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-700">Profit</th>
                                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-700">Margin</th>
                                </tr>
                              </thead>
                              <tbody>
                                {order.lines.map((line, idx) => (
                                  <tr key={idx} className="border-b last:border-0">
                                    <td className="px-3 py-2 text-sm text-slate-900">{line.sku_code}</td>
                                    <td className="px-3 py-2 text-right text-sm text-slate-900">{line.quantity}</td>
                                    <td className="px-3 py-2 text-right text-sm text-slate-900">${line.unitCost.toFixed(2)}</td>
                                    <td className="px-3 py-2 text-right text-sm text-slate-900">${line.totalCost.toFixed(2)}</td>
                                    <td className="px-3 py-2 text-right text-sm font-medium text-slate-900">
                                      {line.revenue > 0 ? `$${line.revenue.toFixed(2)}` : '-'}
                                    </td>
                                    <td className={`px-3 py-2 text-right text-sm font-medium ${line.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      {line.revenue > 0 ? `$${line.profit.toFixed(2)}` : '-'}
                                    </td>
                                    <td className={`px-3 py-2 text-right text-sm font-medium ${line.marginPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      {line.revenue > 0 ? `${line.marginPercent.toFixed(1)}%` : '-'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {order.lines.some(l => l.revenue === 0) && (
                              <div className="mt-3 flex items-center gap-2 text-xs text-orange-600">
                                <AlertCircle className="w-4 h-4" />
                                <span>Some lines are missing revenue data. Upload Excel to match.</span>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          {filteredOrders.length === 0 && (
            <div className="text-center py-12 text-slate-500">
              No fulfilled orders found. Upload revenue data to see profitability.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}