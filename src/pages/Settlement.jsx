import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { format, parseISO, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { DollarSign, TrendingUp, TrendingDown, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import DataTable from '@/components/shared/DataTable';
import CSVUploader from '@/components/shared/CSVUploader';
import StatusBadge from '@/components/ui/StatusBadge';
import PaywallBanner from '@/components/ui/PaywallBanner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';

export default function Settlement() {
  const { tenantId, subscription, isActive } = useTenant();
  const { toast } = useToast();
  const [orders, setOrders] = useState([]);
  const [orderLines, setOrderLines] = useState([]);
  const [skus, setSkus] = useState([]);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [profitFilter, setProfitFilter] = useState('all');
  const [processing, setProcessing] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);

  useEffect(() => {
    if (tenantId) loadData();
  }, [tenantId]);

  const loadData = async () => {
    setLoading(true);
    const [ordersData, linesData, skusData, batchesData] = await Promise.all([
      base44.entities.Order.filter({ tenant_id: tenantId }),
      base44.entities.OrderLine.filter({ tenant_id: tenantId }),
      base44.entities.SKU.filter({ tenant_id: tenantId }),
      base44.entities.ImportBatch.filter({ tenant_id: tenantId, batch_type: 'settlements' })
    ]);
    setOrders(ordersData);
    setOrderLines(linesData);
    setSkus(skusData);
    setBatches(batchesData.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)));
    setLoading(false);
  };

  // Generate month options (last 12 months)
  const monthOptions = useMemo(() => {
    const options = [];
    for (let i = 0; i < 12; i++) {
      const date = subMonths(new Date(), i);
      options.push({
        value: format(date, 'yyyy-MM'),
        label: format(date, 'MMMM yyyy')
      });
    }
    return options;
  }, []);

  // Filter orders by month and settlement status
  const settledOrders = useMemo(() => {
    return orders.filter(o => {
      const hasSettlement = o.net_revenue !== null && o.net_revenue !== undefined;
      if (!hasSettlement) return false;

      const settlementDate = o.settlement_date || o.order_date;
      if (!settlementDate) return false;
      
      const orderMonth = format(parseISO(settlementDate), 'yyyy-MM');
      if (orderMonth !== selectedMonth) return false;

      if (profitFilter === 'profitable') return (o.profit_loss || 0) >= 0;
      if (profitFilter === 'loss') return (o.profit_loss || 0) < 0;
      return true;
    });
  }, [orders, selectedMonth, profitFilter]);

  // Summary stats
  const summary = useMemo(() => {
    const revenue = settledOrders.reduce((sum, o) => sum + (o.net_revenue || 0), 0);
    const cost = settledOrders.reduce((sum, o) => sum + (o.total_cost || 0), 0);
    const profit = settledOrders.reduce((sum, o) => sum + (o.profit_loss || 0), 0);
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    const profitableCount = settledOrders.filter(o => (o.profit_loss || 0) >= 0).length;
    const lossCount = settledOrders.filter(o => (o.profit_loss || 0) < 0).length;

    return { revenue, cost, profit, margin, profitableCount, lossCount, total: settledOrders.length };
  }, [settledOrders]);

  // Product-level profitability
  const skuProfitability = useMemo(() => {
    const skuMap = {};

    for (const order of settledOrders) {
      const lines = orderLines.filter(l => l.order_id === order.id);
      const lineCount = lines.length;
      if (lineCount === 0) continue;

      const revenuePerLine = (order.net_revenue || 0) / lineCount;

      for (const line of lines) {
        if (!skuMap[line.sku_id]) {
          const sku = skus.find(s => s.id === line.sku_id);
          skuMap[line.sku_id] = {
            sku_id: line.sku_id,
            sku_code: line.sku_code || sku?.sku_code || 'Unknown',
            product_name: sku?.product_name || 'Unknown',
            revenue: 0,
            cost: 0,
            quantity: 0,
            orders: 0
          };
        }
        skuMap[line.sku_id].revenue += revenuePerLine;
        skuMap[line.sku_id].cost += line.line_total_cost || 0;
        skuMap[line.sku_id].quantity += line.quantity || 0;
        skuMap[line.sku_id].orders += 1;
      }
    }

    return Object.values(skuMap).map(item => ({
      ...item,
      profit: item.revenue - item.cost,
      margin: item.revenue > 0 ? ((item.revenue - item.cost) / item.revenue) * 100 : 0
    }));
  }, [settledOrders, orderLines, skus]);

  const topSkus = [...skuProfitability].sort((a, b) => b.profit - a.profit).slice(0, 10);
  const bottomSkus = [...skuProfitability].sort((a, b) => a.profit - b.profit).slice(0, 10);

  const handleCSVUpload = async (file) => {
    setProcessing(true);
    
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    
    const result = await base44.integrations.Core.ExtractDataFromUploadedFile({
      file_url,
      json_schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            amazon_order_id: { type: 'string' },
            net_revenue: { type: 'number' },
            settlement_date: { type: 'string' }
          }
        }
      }
    });

    const batch = await base44.entities.ImportBatch.create({
      tenant_id: tenantId,
      batch_type: 'settlements',
      batch_name: `Settlement Import - ${format(new Date(), 'yyyy-MM-dd HH:mm')}`,
      filename: file.name,
      status: 'processing',
      total_rows: 0
    });

    const rows = result.output || [];
    let successCount = 0;
    let failedCount = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      
      if (!row.amazon_order_id) {
        failedCount++;
        errors.push({
          row_number: i + 1,
          raw_row_json: JSON.stringify(row),
          error_reason: 'Missing amazon_order_id'
        });
        continue;
      }

      const order = orders.find(o => o.amazon_order_id === row.amazon_order_id);
      if (!order) {
        failedCount++;
        errors.push({
          row_number: i + 1,
          raw_row_json: JSON.stringify(row),
          error_reason: `Order not found: ${row.amazon_order_id}`
        });
        continue;
      }

      const netRevenue = parseFloat(row.net_revenue) || 0;
      const totalCost = order.total_cost || 0;
      const profitLoss = netRevenue - totalCost;
      const margin = netRevenue > 0 ? (profitLoss / netRevenue) * 100 : 0;

      await base44.entities.Order.update(order.id, {
        net_revenue: netRevenue,
        profit_loss: profitLoss,
        profit_margin_percent: margin,
        settlement_date: row.settlement_date || format(new Date(), 'yyyy-MM-dd')
      });
      successCount++;
    }

    for (const error of errors) {
      await base44.entities.ImportError.create({
        tenant_id: tenantId,
        batch_id: batch.id,
        ...error
      });
    }

    const status = failedCount === 0 ? 'success' : 
                   successCount === 0 ? 'failed' : 'partial';

    await base44.entities.ImportBatch.update(batch.id, {
      status,
      total_rows: rows.length,
      success_rows: successCount,
      failed_rows: failedCount
    });

    setUploadResult({
      status,
      total_rows: rows.length,
      success_rows: successCount,
      failed_rows: failedCount
    });

    setProcessing(false);
    loadData();
  };

  const orderColumns = [
    {
      key: 'amazon_order_id',
      header: 'Order ID',
      render: (val) => <span className="font-medium text-slate-900">{val}</span>
    },
    {
      key: 'order_date',
      header: 'Order Date',
      render: (val) => val ? format(parseISO(val), 'MMM d, yyyy') : '-'
    },
    {
      key: 'settlement_date',
      header: 'Settlement',
      render: (val) => val ? format(parseISO(val), 'MMM d, yyyy') : '-'
    },
    {
      key: 'net_revenue',
      header: 'Revenue',
      align: 'right',
      render: (val) => <span className="text-emerald-600 font-medium">${(val || 0).toFixed(2)}</span>
    },
    {
      key: 'total_cost',
      header: 'Cost',
      align: 'right',
      render: (val) => <span className="text-slate-600">${(val || 0).toFixed(2)}</span>
    },
    {
      key: 'profit_loss',
      header: 'Profit',
      align: 'right',
      render: (val) => (
        <span className={`font-semibold ${(val || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          ${(val || 0).toFixed(2)}
        </span>
      )
    },
    {
      key: 'profit_margin_percent',
      header: 'Margin',
      align: 'right',
      render: (val) => (
        <span className={`${(val || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {(val || 0).toFixed(1)}%
        </span>
      )
    }
  ];

  const skuColumns = [
    {
      key: 'sku_code',
      header: 'SKU',
      render: (val) => <span className="font-medium">{val}</span>
    },
    {
      key: 'product_name',
      header: 'Product'
    },
    {
      key: 'quantity',
      header: 'Units',
      align: 'right'
    },
    {
      key: 'revenue',
      header: 'Revenue',
      align: 'right',
      render: (val) => `$${(val || 0).toFixed(2)}`
    },
    {
      key: 'cost',
      header: 'Cost',
      align: 'right',
      render: (val) => `$${(val || 0).toFixed(2)}`
    },
    {
      key: 'profit',
      header: 'Profit',
      align: 'right',
      render: (val) => (
        <span className={`font-semibold ${(val || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          ${(val || 0).toFixed(2)}
        </span>
      )
    },
    {
      key: 'margin',
      header: 'Margin',
      align: 'right',
      render: (val) => `${(val || 0).toFixed(1)}%`
    }
  ];

  const csvTemplate = 'data:text/csv;charset=utf-8,amazon_order_id,net_revenue,settlement_date\n111-1234567-1234567,49.99,2024-01-15';

  return (
    <div className="space-y-6">
      <PaywallBanner subscription={subscription} onUpgrade={() => {}} />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Settlement & Profitability</h1>
          <p className="text-slate-500">Analyze order profitability and margins</p>
        </div>
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <DollarSign className="w-5 h-5 text-emerald-600" />
            </div>
            <span className="text-slate-500">Revenue</span>
          </div>
          <p className="text-2xl font-bold text-slate-900">${summary.revenue.toLocaleString()}</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-orange-100 rounded-lg">
              <TrendingDown className="w-5 h-5 text-orange-600" />
            </div>
            <span className="text-slate-500">Cost</span>
          </div>
          <p className="text-2xl font-bold text-slate-900">${summary.cost.toLocaleString()}</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className={`p-2 rounded-lg ${summary.profit >= 0 ? 'bg-emerald-100' : 'bg-red-100'}`}>
              <TrendingUp className={`w-5 h-5 ${summary.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`} />
            </div>
            <span className="text-slate-500">Profit</span>
          </div>
          <p className={`text-2xl font-bold ${summary.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            ${summary.profit.toLocaleString()}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <TrendingUp className="w-5 h-5 text-indigo-600" />
            </div>
            <span className="text-slate-500">Margin</span>
          </div>
          <p className="text-2xl font-bold text-slate-900">{summary.margin.toFixed(1)}%</p>
        </div>
      </div>

      <Tabs defaultValue="orders" className="space-y-6">
        <TabsList>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="skus">SKU Profitability</TabsTrigger>
          <TabsTrigger value="import">Import Settlement</TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="space-y-4">
          <div className="flex gap-2">
            <Button 
              variant={profitFilter === 'all' ? 'default' : 'outline'}
              onClick={() => setProfitFilter('all')}
              size="sm"
            >
              All ({summary.total})
            </Button>
            <Button 
              variant={profitFilter === 'profitable' ? 'default' : 'outline'}
              onClick={() => setProfitFilter('profitable')}
              size="sm"
              className={profitFilter === 'profitable' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
            >
              <CheckCircle className="w-4 h-4 mr-1" />
              Profitable ({summary.profitableCount})
            </Button>
            <Button 
              variant={profitFilter === 'loss' ? 'default' : 'outline'}
              onClick={() => setProfitFilter('loss')}
              size="sm"
              className={profitFilter === 'loss' ? 'bg-red-600 hover:bg-red-700' : ''}
            >
              <AlertCircle className="w-4 h-4 mr-1" />
              Loss ({summary.lossCount})
            </Button>
          </div>

          <DataTable
            columns={orderColumns}
            data={settledOrders}
            loading={loading}
            emptyIcon={DollarSign}
            emptyTitle="No settlements"
            emptyDescription="Import settlement data to see profitability"
          />
        </TabsContent>

        <TabsContent value="skus" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-600" />
                Top 10 Most Profitable
              </h3>
              <DataTable
                columns={skuColumns}
                data={topSkus}
                loading={loading}
                emptyTitle="No data"
                emptyDescription="Settlement data needed"
              />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <TrendingDown className="w-5 h-5 text-red-600" />
                Bottom 10 Least Profitable
              </h3>
              <DataTable
                columns={skuColumns}
                data={bottomSkus}
                loading={loading}
                emptyTitle="No data"
                emptyDescription="Settlement data needed"
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="import">
          <CSVUploader
            title="Import Settlement Data"
            description="Upload Amazon settlement report to update order revenue"
            templateUrl={csvTemplate}
            templateName="settlement_template.csv"
            onUpload={handleCSVUpload}
            processing={processing}
            result={uploadResult}
            onReset={() => setUploadResult(null)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}