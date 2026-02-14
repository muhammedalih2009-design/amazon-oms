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

  // Get mode from query params (single or supplier)
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode') || 'single';

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
    <div className="bg-white min-h-screen font-sans" style={{ direction: 'ltr' }}>
      <style>{`
        @page {
          margin: 0.5in;
          size: A4;
        }
        @media print {
          body { margin: 0; padding: 0; }
          .print-page { page-break-after: always; position: relative; }
          .print-page:last-child { page-break-after: avoid; }
          .page-header { 
            position: running(header);
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            color: #6b7280;
            border-bottom: 1px solid #e5e7eb;
            padding-bottom: 8px;
            margin-bottom: 8px;
          }
          .page-break { page-break-before: always; }
          .supplier-section { page-break-inside: avoid; }
          .item-row:hover { background: white; }
        }
        .item-image { 
          max-width: 80px; 
          max-height: 80px; 
          object-fit: contain;
          display: block;
          margin: 0 auto;
        }
        .image-placeholder {
          width: 80px;
          height: 80px;
          background: #f3f4f6;
          border: 1px dashed #d1d5db;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          color: #9ca3af;
          margin: 0 auto;
          border-radius: 4px;
        }
        .product-cell { direction: rtl; unicode-bidi: plaintext; text-align: right; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
        th { background: #e5e7eb; font-weight: bold; padding: 8px; text-align: left; border: 1px solid #d1d5db; font-size: 11px; }
        td { padding: 8px; border: 1px solid #e5e7eb; font-size: 10px; }
        .supplier-section { margin-bottom: 25px; page-break-inside: avoid; }
        .supplier-summary { 
          background: #f3f4f6; 
          padding: 10px 12px; 
          margin-bottom: 10px; 
          font-weight: bold;
          border-radius: 4px;
          display: flex;
          justify-content: space-between;
          border-left: 4px solid #4f46e5;
          font-size: 11px;
        }
        .supplier-name { flex: 1; }
        .supplier-stats { display: flex; gap: 20px; }
        .supplier-stat { text-align: right; }
        .supplier-stat-label { font-weight: normal; color: #6b7280; font-size: 9px; }
      `}</style>

      <div style={{ padding: '20px', marginBottom: '20px', borderBottom: '2px solid #e5e7eb' }}>
        <h1 style={{ fontSize: 18, fontWeight: 'bold', margin: '0 0 8px 0' }}>Purchase Requests</h1>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6b7280' }}>
          <div>
            <strong>Workspace:</strong> {user?.email || 'Workspace'}<br />
            {dateRange?.from && dateRange?.to && (
              <>
                <strong>Period:</strong> {format(dateRange.from, 'MMM d')} - {format(dateRange.to, 'MMM d, yyyy')}
              </>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <strong>Generated:</strong> {format(new Date(), 'MMM d, yyyy HH:mm:ss')}<br />
            <strong>Mode:</strong> {mode === 'supplier' ? 'Per Supplier' : 'All Items'}
          </div>
        </div>
      </div>

      <div style={{ padding: '20px', background: 'white' }}>
        {supplierNames.map((supplierName, idx) => {
        const items = groupedBySupplier[supplierName];
        const supplierTotal = items.reduce((sum, item) => sum + (item.to_buy * item.cost_price), 0);
        const supplierItemCount = items.reduce((sum, item) => sum + item.to_buy, 0);
        const shouldPageBreak = mode === 'supplier' && idx > 0;

        return (
          <div key={supplierName} className={`supplier-section ${shouldPageBreak ? 'page-break' : ''}`}>
            <div className="supplier-summary">
              <div className="supplier-name">{supplierName}</div>
              <div className="supplier-stats">
                <div className="supplier-stat">
                  <div>{items.length}</div>
                  <div className="supplier-stat-label">SKUs</div>
                </div>
                <div className="supplier-stat">
                  <div>{supplierItemCount}</div>
                  <div className="supplier-stat-label">Items</div>
                </div>
                <div className="supplier-stat">
                  <div>${supplierTotal.toFixed(2)}</div>
                  <div className="supplier-stat-label">Total</div>
                </div>
              </div>
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