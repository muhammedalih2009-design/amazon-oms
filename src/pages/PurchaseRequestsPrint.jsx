import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { base44 } from '@/api/base44Client';

export default function PurchaseRequestsPrint() {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadPayload = async () => {
      try {
        // Check authentication first
        try {
          await base44.auth.me();
        } catch (authError) {
          // Not authenticated - redirect to login with clean URL
          const currentUrl = window.location.href;
          const loginUrl = `/login?from_url=${encodeURIComponent(currentUrl)}`;
          window.location.href = loginUrl;
          return;
        }

        const urlParams = new URLSearchParams(window.location.search);
        const jobId = urlParams.get('jobId');

        // Primary path: fetch from backend via jobId
        if (jobId) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout

          try {
            const response = await base44.functions.invoke('getPrintJob', { jobId });
            clearTimeout(timeoutId);

            if (response.data?.payload) {
              setPayload(response.data.payload);
              setLoading(false);
              return;
            } else {
              setError('Print job returned no data. Please try again.');
              setLoading(false);
              return;
            }
          } catch (fetchError) {
            clearTimeout(timeoutId);

            // Handle specific error codes
            if (fetchError.message?.includes('404') || fetchError.message?.includes('not found')) {
              setError('Print job not found. It may have been deleted. Please regenerate PDF.');
            } else if (fetchError.message?.includes('410') || fetchError.message?.includes('expired')) {
              setError('Print job expired. Please go back and regenerate PDF (jobs expire after 10 minutes).');
            } else if (fetchError.message?.includes('405') || fetchError.message?.includes('Method')) {
              setError('Print service method mismatch. Please try again.');
            } else if (fetchError.name === 'AbortError') {
              setError('Request timeout. Please check your connection and try again.');
            } else {
              setError(`Failed to load print job: ${fetchError.message}`);
            }
            setLoading(false);
            return;
          }
        }

        // Fallback: try sessionStorage (backward compatibility)
        const storedPayload = sessionStorage.getItem('pr_print_payload');
        if (storedPayload) {
          const parsed = JSON.parse(storedPayload);
          setPayload(parsed);
          setLoading(false);
          sessionStorage.removeItem('pr_print_payload');
          return;
        }

        // No data source found
        setError('Print data missing. Please go back to Purchase Requests page and click PDF again.');
        setLoading(false);
      } catch (err) {
        setError(`Failed to load print data: ${err.message}`);
        setLoading(false);
      }
    };

    loadPayload();
  }, []);

  useEffect(() => {
    if (payload && !error) {
      // Auto-trigger print after data loads
      const timer = setTimeout(() => {
        window.print();
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [payload, error]);

  if (error) {
    return (
      <div style={{ 
        padding: '40px', 
        textAlign: 'center', 
        fontFamily: 'system-ui, sans-serif',
        maxWidth: '600px',
        margin: '100px auto'
      }}>
        <h2 style={{ color: '#dc2626', marginBottom: '16px', fontSize: '24px' }}>
          ⚠️ Print View Error
        </h2>
        <p style={{ color: '#6b7280', marginBottom: '24px', fontSize: '16px' }}>
          {error}
        </p>
        <button
          onClick={() => window.history.back()}
          style={{
            padding: '10px 20px',
            backgroundColor: '#4f46e5',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500'
          }}
        >
          Go Back
        </button>
      </div>
    );
  }

  if (loading || !payload) {
    return (
      <div style={{ 
        padding: '40px', 
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif'
      }}>
        <div style={{ fontSize: '16px', color: '#6b7280' }}>Loading print view...</div>
      </div>
    );
  }

  const { rows, dateRange, generatedAt, mode } = payload;
  
  // Group by supplier
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
    <html lang="ar">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Purchase Requests - Print</title>
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Noto+Naskh+Arabic:wght@400;700&display=swap" rel="stylesheet" />
        <style>{`
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: 'Cairo', 'Noto Naskh Arabic', Tahoma, Arial, sans-serif;
            font-size: 11px;
            line-height: 1.5;
            color: #1f2937;
            background: #ffffff;
            padding: 20px;
          }

          .no-print {
            margin-bottom: 20px;
            text-align: center;
          }

          .print-button {
            padding: 12px 24px;
            background: #4f46e5;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            font-family: 'Cairo', sans-serif;
          }

          .print-button:hover {
            background: #4338ca;
          }

          .header {
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 3px solid #4f46e5;
          }

          .header h1 {
            font-size: 26px;
            font-weight: 700;
            color: #1f2937;
            margin-bottom: 8px;
          }

          .header-meta {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            color: #6b7280;
            flex-wrap: wrap;
            gap: 8px;
          }

          .supplier-section {
            margin-bottom: 32px;
            page-break-inside: avoid;
          }

          .supplier-header {
            background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
            color: white;
            padding: 14px 18px;
            margin-bottom: 16px;
            border-radius: 6px;
            font-weight: 700;
            font-size: 14px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }

          .supplier-stats {
            font-size: 12px;
            font-weight: 400;
            opacity: 0.95;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 16px;
            font-size: 10px;
          }

          thead {
            background: #f3f4f6;
          }

          th {
            padding: 10px 8px;
            text-align: center;
            font-weight: 700;
            color: #1f2937;
            border: 1px solid #d1d5db;
            background: #e5e7eb;
          }

          td {
            padding: 8px;
            border: 1px solid #e5e7eb;
            text-align: center;
            vertical-align: middle;
            min-height: 100px;
          }

          .img-cell {
            width: 100px;
            text-align: center;
          }

          .img-cell img {
            width: 90px;
            height: 90px;
            object-fit: contain;
            display: block;
            margin: 0 auto;
            border-radius: 4px;
          }

          .img-placeholder {
            width: 90px;
            height: 90px;
            background: #f3f4f6;
            border: 2px dashed #d1d5db;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto;
            border-radius: 4px;
            font-size: 9px;
            color: #9ca3af;
          }

          .supplier-cell {
            text-align: left;
            font-weight: 500;
            width: 120px;
          }

          .sku-cell {
            font-weight: 600;
            color: #4f46e5;
            width: 100px;
          }

          .product-cell {
            direction: rtl;
            text-align: right;
            padding: 10px 12px;
            word-wrap: break-word;
            white-space: normal;
            max-width: 250px;
          }

          .qty-cell {
            font-weight: 700;
            color: #059669;
            width: 70px;
          }

          .cost-cell {
            text-align: right;
            font-family: 'Courier New', monospace;
            width: 90px;
          }

          .subtotal-row {
            background: #f9fafb;
            padding: 10px 15px;
            margin-top: 8px;
            border-radius: 4px;
            text-align: right;
            font-weight: 600;
            font-size: 11px;
            border: 1px solid #e5e7eb;
          }

          .grand-total {
            background: #eef2ff;
            padding: 18px 20px;
            margin-top: 24px;
            border-left: 5px solid #4f46e5;
            font-weight: 700;
            font-size: 14px;
            text-align: right;
            border-radius: 4px;
          }

          .page-break {
            page-break-after: always;
            break-after: page;
          }

          @media print {
            body {
              padding: 0;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }

            .no-print {
              display: none !important;
            }

            .supplier-section {
              page-break-inside: avoid;
            }

            .page-break {
              page-break-after: always;
              break-after: page;
            }

            table {
              width: 100%;
              border-collapse: collapse;
            }

            th, td {
              border: 1px solid #d1d5db;
              padding: 8px;
              vertical-align: middle;
            }

            th {
              background: #f3f4f6 !important;
            }

            .supplier-header {
              background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%) !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }

            .grand-total {
              background: #eef2ff !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          }
        `}</style>
      </head>
      <body>
        <div className="no-print">
          <button onClick={() => window.print()} className="print-button">
            🖨️ Print / Save as PDF
          </button>
        </div>

        <div className="header">
          <h1>Purchase Requests</h1>
          <div className="header-meta">
            <div>
              <strong>Generated:</strong> {format(new Date(generatedAt), 'MMM d, yyyy HH:mm:ss')}
              {dateRange?.from && dateRange?.to && (
                <> | <strong>Period:</strong> {format(new Date(dateRange.from), 'MMM d')} - {format(new Date(dateRange.to), 'MMM d, yyyy')}</>
              )}
            </div>
            <div>
              <strong>Mode:</strong> {mode === 'supplier' ? 'Page per Supplier' : 'All Items'}
            </div>
          </div>
        </div>

        {supplierNames.map((supplierName, idx) => {
          const items = groupedBySupplier[supplierName];
          const supplierTotal = items.reduce((sum, item) => sum + (item.toBuy * item.unitCost), 0);
          const supplierItemCount = items.reduce((sum, item) => sum + item.toBuy, 0);
          const shouldPageBreak = mode === 'supplier' && idx < supplierNames.length - 1;

          return (
            <div key={supplierName}>
              <div className="supplier-section">
                <div className="supplier-header">
                  <span>{supplierName}</span>
                  <span className="supplier-stats">
                    {items.length} SKUs | {supplierItemCount} items | ${supplierTotal.toFixed(2)}
                  </span>
                </div>

                <table>
                  <thead>
                    <tr>
                      <th>IMAGE</th>
                      <th>SUPPLIER</th>
                      <th>SKU CODE</th>
                      <th>PRODUCT</th>
                      <th>TO BUY</th>
                      <th>UNIT COST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, itemIdx) => (
                      <tr key={itemIdx}>
                        <td className="img-cell">
                          {item.imageUrl ? (
                            <img 
                              src={item.imageUrl} 
                              alt="Product"
                              loading="lazy"
                              crossOrigin="anonymous"
                              onError={(e) => {
                                // Only show placeholder after genuine load failure
                                if (!e.target.dataset.retried) {
                                  e.target.dataset.retried = 'true';
                                  // Force reload once
                                  const originalSrc = e.target.src;
                                  e.target.src = '';
                                  setTimeout(() => {
                                    e.target.src = originalSrc + (originalSrc.includes('?') ? '&' : '?') + 'retry=1';
                                  }, 100);
                                } else {
                                  e.target.style.display = 'none';
                                  e.target.parentElement.innerHTML = '<div class="img-placeholder" title="' + item.imageUrl.substring(0, 50) + '">Load Failed</div>';
                                }
                              }}
                            />
                          ) : (
                            <div className="img-placeholder">No Image</div>
                          )}
                        </td>
                        <td className="supplier-cell">{item.supplier}</td>
                        <td className="sku-cell">{item.sku}</td>
                        <td className="product-cell">{item.product}</td>
                        <td className="qty-cell">{item.toBuy}</td>
                        <td className="cost-cell">${(item.unitCost || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="subtotal-row">
                  Subtotal: ${supplierTotal.toFixed(2)}
                </div>
              </div>

              {shouldPageBreak && <div className="page-break"></div>}
            </div>
          );
        })}

        <div className="grand-total">
          GRAND TOTAL: {totalItems} items | ${totalValue.toFixed(2)}
        </div>
      </body>
    </html>
  );
}