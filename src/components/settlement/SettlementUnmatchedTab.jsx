import React, { useMemo, useState } from 'react';
import DataTable from '@/components/shared/DataTable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Download, PlusCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useTenant } from '@/components/hooks/useTenant';
import { useToast } from '@/components/ui/use-toast';

export default function SettlementUnmatchedTab({ rows, tenantId, onDataChange }) {
  const [downloadFormat, setDownloadFormat] = useState('csv');
  const [creatingOrder, setCreatingOrder] = useState(null);
  const { isOwner, membership } = useTenant();
  const { toast } = useToast();

  const isAdmin = isOwner || membership?.role === 'admin';

  const { data: orders = [] } = useQuery({
    queryKey: ['orders', tenantId],
    queryFn: () => base44.entities.Order.filter({ tenant_id: tenantId, is_deleted: false })
  });

  const { data: stores = [] } = useQuery({
    queryKey: ['stores', tenantId],
    queryFn: () => base44.entities.Store.filter({ tenant_id: tenantId })
  });

  // Canonical normalization - matches rematch function
  const normalizeOrderId = (orderId) => {
    if (!orderId) return '';
    return orderId
      .toString()
      .trim()
      .toUpperCase()
      .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
      .replace(/\s+/g, '')
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .replace(/-/g, '');
  };

  const unmatchedOrders = useMemo(() => {
    const orderMap = {};
    
    rows.forEach(row => {
      const orderId = row.order_id;
      const normalizedOrderId = normalizeOrderId(orderId);
      const orderFound = orders.some(o => normalizeOrderId(o.amazon_order_id) === normalizedOrderId);

      if (!orderFound && !row.is_deleted) {
        if (!orderMap[orderId]) {
          orderMap[orderId] = {
            order_id: orderId,
            rows_count: 0,
            skus: new Set(),
            total_value: 0,
            datetime: row.datetime,
            marketplace: row.marketplace
          };
        }

        orderMap[orderId].rows_count++;
        if (row.sku) orderMap[orderId].skus.add(row.sku);
        orderMap[orderId].total_value += row.total;
      }
    });

    return Object.values(orderMap).map(order => {
      const normalized = normalizeOrderId(order.order_id);
      
      // Check if any order partially matches
      const partialMatch = orders.some(o => {
        const norm = normalizeOrderId(o.amazon_order_id);
        return norm.length >= 8 && normalized.length >= 8 &&
               (norm.includes(normalized.slice(0, 10)) || normalized.includes(norm.slice(0, 10)));
      });
      
      return {
        ...order,
        skus_count: order.skus.size,
        normalized_id: normalized,
        reason: partialMatch 
          ? 'Order exists but ID format mismatch' 
          : 'Order not found after canonical normalization'
      };
    });
  }, [rows, orders]);

  const unmatchedSkus = useMemo(() => {
    return rows.filter(r => r.match_status === 'unmatched_sku').map(r => ({
      ...r,
      reason: 'SKU not found in master data'
    }));
  }, [rows]);

  const handleCreateOrder = async (settlementOrder) => {
    setCreatingOrder(settlementOrder.order_id);
    try {
      let storeId = null;
      if (stores.length > 0) {
        storeId = stores[0].id;
      } else {
        const newStore = await base44.entities.Store.create({
          tenant_id: tenantId,
          name: 'Default Store',
          platform: 'Amazon'
        });
        storeId = newStore.id;
      }

      await base44.entities.Order.create({
        tenant_id: tenantId,
        amazon_order_id: settlementOrder.order_id,
        store_id: storeId,
        order_date: settlementOrder.datetime?.split('T')[0] || new Date().toISOString().split('T')[0],
        status: 'fulfilled',
        net_revenue: settlementOrder.total_value || 0,
        total_cost: 0,
        profit_loss: settlementOrder.total_value || 0,
        profit_margin_percent: 100
      });

      toast({
        title: 'Order Created',
        description: `Created order ${settlementOrder.order_id}. Update cost in Orders page.`
      });

      if (onDataChange) onDataChange();
    } catch (error) {
      toast({
        title: 'Create Failed',
        description: error.message || 'Failed to create order',
        variant: 'destructive'
      });
    } finally {
      setCreatingOrder(null);
    }
  };

  const downloadUnmatched = (type) => {
    const data = type === 'orders' ? unmatchedOrders : unmatchedSkus;
    const headers = type === 'orders' 
      ? ['Order ID', 'Rows Count', 'SKUs Count', 'Total Value', 'Reason']
      : ['Order ID', 'SKU', 'Type', 'Signed Qty', 'Total', 'Reason'];
    
    const rows = type === 'orders'
      ? data.map(r => [r.order_id, r.rows_count, r.skus_count, r.total_value.toFixed(2), r.reason])
      : data.map(r => [r.order_id, r.sku, r.type, r.signed_qty, r.total.toFixed(2), r.reason]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `unmatched_${type}_${new Date().toISOString().substring(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const ordersColumns = [
    { 
      key: 'order_id', 
      header: 'Order ID',
      render: (val, row) => (
        <div className="space-y-1">
          <div className="font-mono">{val}</div>
          <div className="text-xs text-slate-500">Normalized: {row.normalized_id}</div>
        </div>
      )
    },
    { key: 'rows_count', header: 'Settlement Rows', align: 'right' },
    { key: 'skus_count', header: 'Unique SKUs', align: 'right' },
    { key: 'total_value', header: 'Total Value', align: 'right', render: (val) => `$${val.toFixed(2)}` },
    { 
      key: 'reason', 
      header: 'Reason',
      render: (val) => (
        <span className={val.includes('mismatch') ? 'text-amber-600' : 'text-red-600'}>
          {val}
        </span>
      )
    },
    ...(isAdmin ? [{
      key: 'actions',
      header: 'Actions',
      render: (_, row) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleCreateOrder(row)}
          disabled={creatingOrder === row.order_id}
        >
          <PlusCircle className="w-4 h-4 mr-2" />
          {creatingOrder === row.order_id ? 'Creating...' : 'Create Order'}
        </Button>
      )
    }] : [])
  ];

  const skusColumns = [
    { key: 'order_id', header: 'Order ID' },
    { key: 'sku', header: 'SKU' },
    { key: 'type', header: 'Type' },
    { key: 'signed_qty', header: 'Signed Qty', align: 'right' },
    { key: 'total', header: 'Total', align: 'right', render: (val) => `$${val.toFixed(2)}` },
    { key: 'reason', header: 'Reason' }
  ];

  return (
    <Tabs defaultValue="orders" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="orders">Unmatched Orders ({unmatchedOrders.length})</TabsTrigger>
        <TabsTrigger value="skus">Unmatched SKUs ({unmatchedSkus.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="orders" className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-amber-800">
            <strong>Orders not found in Orders table.</strong> These settlement orders do not have a matching order record.
            {isAdmin && ' You can create placeholder orders and update their cost later, or import a full orders CSV.'}
          </p>
        </div>
        <div className="flex justify-end">
          <Button
            onClick={() => downloadUnmatched('orders')}
            variant="outline"
            size="sm"
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
        <DataTable columns={ordersColumns} data={unmatchedOrders} />
      </TabsContent>

      <TabsContent value="skus" className="space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-blue-800">
            <strong>SKUs not found in SKU master data.</strong> These are SKU codes from settlement that don't match any SKU in your inventory.
          </p>
        </div>
        <div className="flex justify-end">
          <Button
            onClick={() => downloadUnmatched('skus')}
            variant="outline"
            size="sm"
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
        <DataTable columns={skusColumns} data={unmatchedSkus} />
      </TabsContent>
    </Tabs>
  );
}