import React, { useMemo, useState } from 'react';
import DataTable from '@/components/shared/DataTable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

export default function SettlementUnmatchedTab({ rows }) {
  const [downloadFormat, setDownloadFormat] = useState('csv');

  const unmatchedOrders = useMemo(() => {
    return rows.filter(r => r.match_status === 'unmatched_order').map(r => ({
      ...r,
      reason: 'Order not found in OMS'
    }));
  }, [rows]);

  const unmatchedSkus = useMemo(() => {
    return rows.filter(r => r.match_status === 'unmatched_sku').map(r => ({
      ...r,
      reason: 'SKU not found in master data'
    }));
  }, [rows]);

  const downloadUnmatched = (type) => {
    const data = type === 'orders' ? unmatchedOrders : unmatchedSkus;
    const headers = ['Order ID', 'SKU', 'Type', 'Signed Qty', 'Total', 'Reason'];
    const rows = data.map(r => [
      r.order_id,
      r.sku,
      r.type,
      r.signed_qty,
      r.total.toFixed(2),
      r.reason
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `unmatched_${type}_${new Date().toISOString().substring(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns = [
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
        <DataTable columns={columns} data={unmatchedOrders} />
      </TabsContent>

      <TabsContent value="skus" className="space-y-4">
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
        <DataTable columns={columns} data={unmatchedSkus} />
      </TabsContent>
    </Tabs>
  );
}