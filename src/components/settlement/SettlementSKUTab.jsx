import React, { useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import DataTable from '@/components/shared/DataTable';
import { useQuery } from '@tanstack/react-query';

export default function SettlementSKUTab({ rows, tenantId }) {
  const { data: skus = [] } = useQuery({
    queryKey: ['skus', tenantId],
    queryFn: () => base44.entities.SKU.filter({ tenant_id: tenantId })
  });

  const skuProfit = useMemo(() => {
    const skuMap = {};

    rows.forEach(row => {
      const sku = row.sku;
      if (!skuMap[sku]) {
        skuMap[sku] = {
          sku: sku,
          net_total: 0,
          signed_units: 0,
          cogs: 0,
          unit_cost: 0,
          matched_sku_id: null
        };
      }

      skuMap[sku].net_total += row.total;
      skuMap[sku].signed_units += row.signed_qty;
      
      if (row.matched_sku_id) {
        skuMap[sku].matched_sku_id = row.matched_sku_id;
      }
    });

    return Object.values(skuMap).map(skuData => {
      const skuRecord = skus.find(s => s.id === skuData.matched_sku_id || s.sku_code === skuData.sku);
      const unitCost = skuRecord?.cost_price || 0;
      const cogs = unitCost * skuData.signed_units;

      return {
        ...skuData,
        product_name: skuRecord?.product_name || 'Unknown',
        unit_cost: unitCost,
        cogs: cogs,
        profit: skuData.net_total - cogs,
        margin: skuData.net_total !== 0 ? ((skuData.net_total - cogs) / skuData.net_total) * 100 : 0,
        status: !unitCost ? 'Needs Cost' : 'OK'
      };
    }).sort((a, b) => Math.abs(b.profit) - Math.abs(a.profit));
  }, [rows, skus]);

  const columns = [
    { key: 'sku', header: 'SKU Code', sortable: true },
    { key: 'product_name', header: 'Product Name', sortable: true },
    { key: 'signed_units', header: 'Units (Signed)', align: 'right' },
    {
      key: 'net_total',
      header: 'Net Total',
      align: 'right',
      render: (val) => `$${val.toFixed(2)}`
    },
    {
      key: 'unit_cost',
      header: 'Unit Cost',
      align: 'right',
      render: (val) => val > 0 ? `$${val.toFixed(2)}` : '—'
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
      header: 'Margin %',
      align: 'right',
      render: (val) => `${val.toFixed(1)}%`
    },
    { key: 'status', header: 'Status' }
  ];

  return <DataTable columns={columns} data={skuProfit} />;
}