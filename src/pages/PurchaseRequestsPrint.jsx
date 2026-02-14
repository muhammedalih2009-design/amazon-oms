import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { format, parseISO, isWithinInterval } from 'date-fns';

export default function PurchaseRequestsPrint() {
  const { tenantId, user } = useTenant();
  const [orders, setOrders] = useState([]);
  const [orderLines, setOrderLines] = useState([]);
  const [skus, setSkus] = useState([]);
  const [currentStock, setCurrentStock] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateRange] = useState({
    from: new Date(),
    to: new Date(new Date().setDate(new Date().getDate() + 7))
  });

  useEffect(() => {
    if (tenantId) loadData();
  }, [tenantId]);

  const loadData = async () => {
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
    setLoading(false);
  };

  const normalizeSku = (sku) => {
    const t = (sku ?? '').toString().trim();
    return t
      .replace(/[\s\r\n]+/g, '')
      .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
      .replace(/[-_]+/g, '')
      .replace(/[^0-9A-Za-z]+/g, '')
      .toUpperCase();
  };

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

  const purchaseNeeds = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return [];

    const pendingOrders = orders.filter(o => {
      if (o.status !== 'pending') return false;
      if (!o.order_date) return true;
      const orderDate = parseISO(o.order_date);
      return isWithinInterval(orderDate, { start: dateRange.from, end: dateRange.to });
    });

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

    return Object.entries(skuNeeds).map(([skuId, needed]) => {
      const sku = skus.find(s => s.id === skuId);
      const stock = currentStock.find(s => s.sku_id === skuId);
      const available = stock?.quantity_available || 0;
      const toBuy = Math.max(0, needed - available);

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
        supplierResolved = (md?.supplier || md?.vendor || md?.Supplier || '').toString().trim()
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
        image_url: sku?.image_url
      };
    }).filter(item => item.to_buy > 0);
  }, [orders, orderLines, skus, currentStock, suppliers, dateRange, masterLookup]);

  const sortedItems = useMemo(() => {
    return [...purchaseNeeds].sort((a, b) => {
      const sa = (a.supplier || 'Unassigned').toString().trim().toLowerCase();
      const sb = (b.supplier || 'Unassigned').toString().trim().toLowerCase();
      const cmp = sa.localeCompare(sb, 'en', { sensitivity: 'base' });
      if (cmp !== 0) return cmp;
      return (a.sku_code || '').localeCompare(b.sku_code || '', 'en', { sensitivity: 'base' });
    });
  }, [purchaseNeeds]);

  const groupedBySupplier = useMemo(() => {
    return sortedItems.reduce((acc, item) => {
      const supplier = item.supplier || 'Unassigned';
      if (!acc[supplier]) acc[supplier] = [];
      acc[supplier].push(item);
      return acc;
    }, {});
  }, [sortedItems]);

  const supplierNames = useMemo(() => {
    return Object.keys(groupedBySupplier).sort((a, b) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b, 'en', { sensitivity: 'base' });
    });
  }, [groupedBySupplier]);

  const totalValue = purchaseNeeds.reduce((sum, p) => sum + (p.to_buy * p.cost_price), 0);
  const totalItems = purchaseNeeds.reduce((sum, p) => sum + p.to_buy, 0);

  if (loading) {
    return <div className="p-8 text-center">Loading...</div>;
  }

  return (
    <div className="p-8 bg-white min-h-screen font-sans" style={{ direction: 'ltr' }}>
      <style>{`
        @media print {
          body { margin: 0; padding: 10px; }
          .page-break { page-break-before: always; }
          .supplier-section { page-break-inside: avoid; }
          .item-row:hover { background: white; }
        }
        .item-image { max-width: 80px; max-height: 80px; object-fit: contain; }
        .product-cell { direction: rtl; unicode-bidi: plaintext; text-align: right; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th { background: #e5e7eb; font-weight: bold; padding: 8px; text-align: left; border: 1px solid #d1d5db; }
        td { padding: 8px; border: 1px solid #e5e7eb; }
        .supplier-section { margin-bottom: 30px; page-break-inside: avoid; }
        .supplier-header { background: #f3f4f6; padding: 12px; margin-bottom: 10px; font-weight: bold; border-radius: 4px; display: flex; justify-content: space-between; }
      `}</style>

      <div style={{ textAlign: 'center', marginBottom: 30, borderBottom: '2px solid #e5e7eb', paddingBottom: 15 }}>
        <h1 style={{ fontSize: 24, fontWeight: 'bold', margin: '0 0 10px 0' }}>Purchase Requests</h1>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280' }}>
          <div>
            <strong>Workspace:</strong> {user?.email || 'Workspace'}<br />
            <strong>Date:</strong> {format(new Date(), 'MMM d, yyyy')}
          </div>
          <div style={{ textAlign: 'right' }}>
            {dateRange?.from && dateRange?.to && (
              <>
                <strong>Period:</strong> {format(dateRange.from, 'MMM d')} - {format(dateRange.to, 'MMM d, yyyy')}
              </>
            )}
          </div>
        </div>
      </div>

      {supplierNames.map((supplierName, idx) => {
        const items = groupedBySupplier[supplierName];
        const supplierTotal = items.reduce((sum, item) => sum + (item.to_buy * item.cost_price), 0);
        const supplierItemCount = items.reduce((sum, item) => sum + item.to_buy, 0);

        return (
          <div key={supplierName} className={`supplier-section ${idx > 0 ? 'page-break' : ''}`}>
            <div className="supplier-header">
              <strong>{supplierName}</strong>
              <span style={{ fontWeight: 'normal', fontSize: 12, color: '#6b7280' }}>
                {items.length} SKUs • {supplierItemCount} items • ${supplierTotal.toFixed(2)}
              </span>
            </div>

            <table>
              <thead>
                <tr>
                  <th style={{ width: 110, textAlign: 'center' }}>IMAGE</th>
                  <th style={{ width: 100 }}>SUPPLIER</th>
                  <th style={{ width: 90 }}>SKU CODE</th>
                  <th style={{ flex: 1, minWidth: 150 }}>PRODUCT</th>
                  <th style={{ width: 60, textAlign: 'center' }}>TO BUY</th>
                  <th style={{ width: 80, textAlign: 'right' }}>UNIT COST</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.sku_id} className="item-row">
                    <td style={{ textAlign: 'center', padding: 6 }}>
                      {item.image_url && (
                        <img src={item.image_url} alt="SKU" className="item-image" />
                      )}
                    </td>
                    <td style={{ fontSize: 10 }}>{item.supplier}</td>
                    <td style={{ fontSize: 10, fontWeight: 600 }}>{item.sku_code}</td>
                    <td className="product-cell" style={{ fontSize: 11 }}>
                      {item.product_name}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 'bold', color: '#4f46e5' }}>
                      {item.to_buy}
                    </td>
                    <td style={{ textAlign: 'right', fontSize: 10 }}>
                      ${(item.cost_price || 0).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      <div style={{ marginTop: 30, padding: 15, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 4, textAlign: 'right' }}>
        <div style={{ fontSize: 12, marginBottom: 8 }}>
          <strong>GRAND TOTAL:</strong> {totalItems} items • <strong>${totalValue.toFixed(2)}</strong>
        </div>
      </div>
    </div>
  );
}