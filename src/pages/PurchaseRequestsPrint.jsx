import React, { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';

export default function PurchaseRequestsPrint() {
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode') || 'single';
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('PR_PRINT_PAYLOAD');
      if (!raw) {
        setError('Print payload missing. Please go back and click PDF again.');
        return;
      }
      const parsed = JSON.parse(raw);
      setPayload(parsed);
    } catch (err) {
      setError(`Failed to load print data: ${err.message}`);
    }
  }, []);

  if (error) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <h2 style={{ color: '#dc2626', marginBottom: '16px' }}>⚠️ Print View Error</h2>
        <p style={{ color: '#6b7280', marginBottom: '24px' }}>{error}</p>
        <button
          onClick={() => window.history.back()}
          style={{
            padding: '8px 16px',
            backgroundColor: '#4f46e5',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          Go Back
        </button>
      </div>
    );
  }

  if (!payload) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Loading print view...</div>;
  }

  const { rows, dateRange, generatedAt } = payload;
  const groupedBySupplier = rows.reduce((acc, item) => {
    const supplier = item.supplier || 'Unassigned';
    if (!acc[supplier]) acc[supplier] = [];
    acc[supplier].push(item);
    return acc;
  }, {});

  const supplierNames = Object.keys(groupedBySupplier).sort((a, b) => {
    if (a === 'Unassigned') return 1;
    if (b === 'Unassigned') return -1;
    return a.localeCompare(b, 'en', { sensitivity: 'base' });
  });

  const totalValue = rows.reduce((sum, r) => sum + (r.toBuy * r.unitCost), 0);
  const totalItems = rows.reduce((sum, r) => sum + r.toBuy, 0);

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
                    <td style={{ textAlign: 'center', padding: 6, width: 110, height: 90 }}>
                      {item.image_url ? (
                        <img 
                          src={item.image_url} 
                          alt="SKU" 
                          className="item-image"
                          onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.parentElement.innerHTML = '<div class="image-placeholder">No image</div>';
                          }}
                        />
                      ) : (
                        <div className="image-placeholder">No image</div>
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
      </div>

      <div style={{ padding: '20px' }}>
       <div style={{ marginTop: 10, padding: 15, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 4, textAlign: 'right' }}>
         <div style={{ fontSize: 12, marginBottom: 8 }}>
           <strong>GRAND TOTAL:</strong> {totalItems} items • <strong>${totalValue.toFixed(2)}</strong>
         </div>
       </div>
      </div>
      </div>
      );
      }