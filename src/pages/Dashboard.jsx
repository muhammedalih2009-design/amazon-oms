import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { format, subDays, startOfMonth, parseISO, isWithinInterval } from 'date-fns';
import { ShoppingCart, Package, DollarSign, TrendingUp, Clock, CheckCircle } from 'lucide-react';
import KPICard from '@/components/dashboard/KPICard';
import OrdersChart from '@/components/dashboard/OrdersChart';
import RevenueChart from '@/components/dashboard/RevenueChart';
import TopSKUsChart from '@/components/dashboard/TopSKUsChart';
import RecentOrdersTable from '@/components/dashboard/RecentOrdersTable';
import DateRangeFilter from '@/components/dashboard/DateRangeFilter';
import PaywallBanner from '@/components/ui/PaywallBanner';
import { KPISkeleton, ChartSkeleton } from '@/components/ui/LoadingSkeleton';
import PendingTasksWidget from '@/components/dashboard/PendingTasksWidget';
import PagePermissionGuard from '@/components/shared/PagePermissionGuard';
import RefreshButton from '@/components/shared/RefreshButton';
import { formatCurrency } from '@/components/utils/formatCurrency';

export default function Dashboard() {
  const { tenantId, subscription, isActive, user, currency, locale } = useTenant();
  const [orders, setOrders] = useState([]);
  const [orderLines, setOrderLines] = useState([]);
  const [currentStock, setCurrentStock] = useState([]);
  const [skus, setSkus] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dateRange, setDateRange] = useState({
    from: subDays(new Date(), 30),
    to: new Date()
  });

  useEffect(() => {
    if (tenantId) {
      loadData();
    }
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

  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const loadData = async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      
      // Load data sequentially with small delays to avoid rate limits
      const ordersData = await base44.entities.Order.filter({ tenant_id: tenantId });
      await delay(100);
      
      const linesData = await base44.entities.OrderLine.filter({ tenant_id: tenantId });
      await delay(100);
      
      const stockData = await base44.entities.CurrentStock.filter({ tenant_id: tenantId });
      await delay(100);
      
      const skusData = await base44.entities.SKU.filter({ tenant_id: tenantId });
      await delay(100);
      
      const purchasesData = await base44.entities.Purchase.filter({ tenant_id: tenantId });
      
      setOrders(ordersData);
      setOrderLines(linesData);
      setCurrentStock(stockData);
      setSkus(skusData);
      setPurchases(purchasesData);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      
      // Retry once after delay if rate limited
      if (error.message?.includes('429') || error.message?.includes('Rate limit')) {
        console.log('Rate limit hit, retrying after delay...');
        await delay(2000);
        try {
          const ordersData = await base44.entities.Order.filter({ tenant_id: tenantId });
          await delay(200);
          const linesData = await base44.entities.OrderLine.filter({ tenant_id: tenantId });
          await delay(200);
          const stockData = await base44.entities.CurrentStock.filter({ tenant_id: tenantId });
          await delay(200);
          const skusData = await base44.entities.SKU.filter({ tenant_id: tenantId });
          await delay(200);
          const purchasesData = await base44.entities.Purchase.filter({ tenant_id: tenantId });
          
          setOrders(ordersData);
          setOrderLines(linesData);
          setCurrentStock(stockData);
          setSkus(skusData);
          setPurchases(purchasesData);
        } catch (retryError) {
          console.error('Retry failed:', retryError);
        }
      }
    } finally {
      if (isRefresh) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  };

  const filteredOrders = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return orders;
    return orders.filter(order => {
      if (!order.order_date) return false;
      const orderDate = parseISO(order.order_date);
      return isWithinInterval(orderDate, { start: dateRange.from, end: dateRange.to });
    });
  }, [orders, dateRange]);

  const filteredPurchases = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return purchases;
    return purchases.filter(purchase => {
      if (!purchase.purchase_date) return false;
      const purchaseDate = parseISO(purchase.purchase_date);
      return isWithinInterval(purchaseDate, { start: dateRange.from, end: dateRange.to });
    });
  }, [purchases, dateRange]);

  const kpis = useMemo(() => {
    const pending = filteredOrders.filter(o => o.status === 'pending').length;
    const fulfilled = filteredOrders.filter(o => o.status === 'fulfilled').length;
    const revenue = filteredOrders.reduce((sum, o) => sum + (o.net_revenue || 0), 0);
    const profit = filteredOrders.reduce((sum, o) => sum + (o.profit_loss || 0), 0);
    const stockValue = currentStock.reduce((sum, s) => {
      const sku = skus.find(sk => sk.id === s.sku_id);
      return sum + ((s.quantity_available || 0) * (sku?.cost_price || 0));
    }, 0);
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

    // Calculate purchased stock costs - FIXED: filter by supplier_name exact match
    const purchasedCostSuppliers = filteredPurchases
      .filter(p => p.supplier_name && p.supplier_name !== 'Warehouse')
      .reduce((sum, p) => sum + (p.total_cost || 0), 0);
    
    const purchasedCostWarehouse = filteredPurchases
      .filter(p => p.supplier_name === 'Warehouse')
      .reduce((sum, p) => sum + (p.total_cost || 0), 0);

    // Integrity warning
    if (filteredOrders.length > 0 && revenue === 0) {
      console.warn('[Dashboard] KPIs: Zero revenue despite having orders', {
        total_orders: filteredOrders.length,
        date_range: dateRange
      });
    }

    return {
      totalOrders: filteredOrders.length,
      pending,
      fulfilled,
      revenue,
      profit,
      stockValue,
      margin,
      purchasedCostSuppliers,
      purchasedCostWarehouse
    };
  }, [filteredOrders, filteredPurchases, currentStock, skus, dateRange]);

  const ordersChartData = useMemo(() => {
    const dateMap = {};
    filteredOrders.forEach(order => {
      if (order.order_date) {
        const date = order.order_date;
        dateMap[date] = (dateMap[date] || 0) + 1;
      }
    });
    return Object.entries(dateMap)
      .map(([date, orders]) => ({ date, orders }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredOrders]);

  const revenueChartData = useMemo(() => {
    const monthMap = {};
    
    // Aggregate ALL orders in workspace, not filtered by date range
    orders.forEach(order => {
      if (order.order_date && !order.is_deleted) {
        const month = format(parseISO(order.order_date), 'MMM yyyy');
        if (!monthMap[month]) {
          monthMap[month] = { revenue: 0, cost: 0, profit: 0 };
        }
        monthMap[month].revenue += order.net_revenue || 0;
        monthMap[month].cost += order.total_cost || 0;
        monthMap[month].profit += order.profit_loss || 0;
      }
    });
    
    // Log for debugging
    const totalRevenue = Object.values(monthMap).reduce((sum, m) => sum + m.revenue, 0);
    if (orders.length > 0 && totalRevenue === 0) {
      console.warn('[Dashboard] Revenue chart: Zero revenue despite having orders', {
        orders_count: orders.length,
        months: Object.keys(monthMap).length
      });
    }
    
    return Object.entries(monthMap)
      .map(([month, data]) => ({ month, ...data }))
      .slice(-6);
  }, [orders]);

  const topSKUsData = useMemo(() => {
    const skuMap = {};
    orderLines.forEach(line => {
      const code = line.sku_code || line.sku_id;
      skuMap[code] = (skuMap[code] || 0) + (line.quantity || 0);
    });
    return Object.entries(skuMap)
      .map(([sku_code, quantity]) => ({ sku_code, quantity }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);
  }, [orderLines]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        </div>
        <KPISkeleton />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      </div>
    );
  }

  return (
    <PagePermissionGuard pageKey="dashboard">
      <div className="space-y-6">
        <PaywallBanner subscription={subscription} onUpgrade={() => {}} />
        
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <div className="flex items-center gap-3">
          <RefreshButton onRefresh={() => loadData(true)} loading={refreshing} />
          <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
        </div>
      </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPICard
          title="Total Orders"
          value={kpis.totalOrders}
          icon={ShoppingCart}
          iconBg="bg-indigo-100"
          iconColor="text-indigo-600"
        />
        <KPICard
          title="Pending Orders"
          value={kpis.pending}
          icon={Clock}
          iconBg="bg-amber-100"
          iconColor="text-amber-600"
        />
        <KPICard
          title="Fulfilled Orders"
          value={kpis.fulfilled}
          icon={CheckCircle}
          iconBg="bg-emerald-100"
          iconColor="text-emerald-600"
        />
        <KPICard
          title="Stock Value"
          value={`$${kpis.stockValue.toLocaleString()}`}
          icon={Package}
          iconBg="bg-violet-100"
          iconColor="text-violet-600"
        />
        <KPICard
          title="Purchased Stock Cost (Suppliers)"
          value={`$${kpis.purchasedCostSuppliers.toLocaleString()}`}
          icon={Package}
          iconBg="bg-blue-100"
          iconColor="text-blue-600"
        />
        <KPICard
          title="Purchased Stock Cost (Warehouse)"
          value={`$${kpis.purchasedCostWarehouse.toLocaleString()}`}
          icon={Package}
          iconBg="bg-slate-100"
          iconColor="text-slate-600"
        />
        <KPICard
          title="Monthly Revenue"
          value={`$${kpis.revenue.toLocaleString()}`}
          icon={DollarSign}
          iconBg="bg-emerald-100"
          iconColor="text-emerald-600"
        />
        <KPICard
          title="Monthly Profit"
          value={`$${kpis.profit.toLocaleString()}`}
          icon={TrendingUp}
          iconBg="bg-blue-100"
          iconColor="text-blue-600"
        />
        <KPICard
          title="Profit Margin"
          value={`${kpis.margin.toFixed(1)}%`}
          icon={TrendingUp}
          iconBg="bg-purple-100"
          iconColor="text-purple-600"
        />
      </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <OrdersChart data={ordersChartData} />
        <RevenueChart data={revenueChartData} />
      </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <TopSKUsChart data={topSKUsData} />
          <RecentOrdersTable orders={orders.sort((a, b) => (b.order_date || '').localeCompare(a.order_date || ''))} />
          <PendingTasksWidget tenantId={tenantId} userId={user?.id} />
        </div>
      </div>
    </PagePermissionGuard>
  );
}