import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import DataTable from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';

export default function SettlementOrdersTab({ rows, tenantId }) {
  const [filterStatus, setFilterStatus] = useState('all');

  const { data: skus = [] } = useQuery({
    queryKey: ['skus', tenantId],
    queryFn: () => base44.entities.SKU.filter({ tenant_id: tenantId })
  });

  const orderProfit = useMemo(() => {
    const orderMap = {};

    rows.forEach(row => {
      const orderId = row.order_id;
      if (!orderMap[orderId]) {
        orderMap[orderId] = {
          order_id: orderId,
          net_total: 0,
          signed_units: 0,
          cogs: 0,
          matched_rows: 0,
          unmatched_rows: 0,
          rows: []
        };
      }

      orderMap[orderId].net_total += row.total;
      orderMap[orderId].signed_units += row.signed_qty;
      orderMap[orderId].rows.push(row);

      if (row.match_status === 'matched') {
        orderMap[orderId].matched_rows++;
        const sku = skus.find(s => s.id === row.matched_sku_id);
        if (sku && sku.cost_price) {
          orderMap[orderId].cogs += sku.cost_price * row.signed_qty;
        }
      } else {
        orderMap[orderId].unmatched_rows++;
      }
    });

    return Object.values(orderMap).map(order => ({
      ...order,
      profit: order.net_total - order.cogs,
      margin: order.net_total !== 0 ? ((order.net_total - order.cogs) / order.net_total) * 100 : 0,
      status: order.unmatched_rows > 0 ? 'Partial' : order.profit < 0 ? 'Loss' : 'Profitable'
    })).filter(order => {
      if (filterStatus === 'profitable') return order.profit > 0;
      if (filterStatus === 'loss') return order.profit < 0;
      if (filterStatus === 'partial') return order.unmatched_rows > 0;
      return true;
    });
  }, [rows, skus, filterStatus]);

  const columns = [
    { key: 'order_id', header: 'Order ID', sortable: true },
    { key: 'signed_units', header: 'Units', align: 'right' },
    {
      key: 'net_total',
      header: 'Net Revenue',
      align: 'right',
      render: (val) => `$${val.toFixed(2)}`
    },
    {
      key: 'cogs',
      header: 'COGS',
      align: 'right',
      render: (val) => `$${val.toFixed(2)}`
    },
    {
      key: 'profit',
      header: 'Profit',
      align: 'right',
      render: (val) => (
        <span className={val < 0 ? 'text-red-600 font-bold' : 'text-emerald-600 font-bold'}>
          ${val.toFixed(2)}
        </span>
      )
    },
    {
      key: 'margin',
      header: 'Margin',
      align: 'right',
      render: (val) => `${val.toFixed(1)}%`
    },
    {
      key: 'matched_rows',
      header: 'Matched / Unmatched',
      render: (_, row) => `${row.matched_rows} / ${row.unmatched_rows}`
    }
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          variant={filterStatus === 'all' ? 'default' : 'outline'}
          onClick={() => setFilterStatus('all')}
          size="sm"
        >
          All
        </Button>
        <Button
          variant={filterStatus === 'profitable' ? 'default' : 'outline'}
          onClick={() => setFilterStatus('profitable')}
          size="sm"
        >
          Profitable
        </Button>
        <Button
          variant={filterStatus === 'loss' ? 'default' : 'outline'}
          onClick={() => setFilterStatus('loss')}
          size="sm"
        >
          Loss
        </Button>
        <Button
          variant={filterStatus === 'partial' ? 'default' : 'outline'}
          onClick={() => setFilterStatus('partial')}
          size="sm"
        >
          Partial Match
        </Button>
      </div>

      <DataTable columns={columns} data={orderProfit} />
    </div>
  );
}