import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { format, parseISO, isWithinInterval } from 'date-fns';
import { ClipboardList, ShoppingCart, Check, Calculator, FileDown } from 'lucide-react';
import RefreshButton from '@/components/shared/RefreshButton';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import bidi from 'bidi-js';
import JSZip from 'jszip';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon } from 'lucide-react';
import DataTable from '@/components/shared/DataTable';
import PaywallBanner from '@/components/ui/PaywallBanner';
import { useToast } from '@/components/ui/use-toast';

export default function PurchaseRequests() {
  const { tenantId, subscription, isActive } = useTenant();
  const { toast } = useToast();
  const [orders, setOrders] = useState([]);
  const [orderLines, setOrderLines] = useState([]);
  const [skus, setSkus] = useState([]);
  const [currentStock, setCurrentStock] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSkus, setSelectedSkus] = useState([]);
  const [dateRange, setDateRange] = useState({
    from: new Date(),
    to: new Date(new Date().setDate(new Date().getDate() + 7))
  });
  const [exportMode, setExportMode] = useState('single'); // 'single' or 'per-supplier'
  const [debugMode, setDebugMode] = useState(false);

  useEffect(() => {
    if (tenantId) loadData();
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

  const loadData = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
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
    if (isRefresh) {
      setRefreshing(false);
    } else {
      setLoading(false);
    }
  };

  // Normalize SKU for matching
  const normalizeSku = (sku) => {
    const t = (sku ?? '').toString().trim();
    return t
      .replace(/[\s\r\n]+/g, '')
      .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
      .replace(/[-_]+/g, '')
      .replace(/[^0-9A-Za-z]+/g, '')
      .toUpperCase();
  };

  // Build Master Data lookup map
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

  // Auto-calculate needs when date range changes
  const purchaseNeeds = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return [];

    // Filter pending orders in date range
    const pendingOrders = orders.filter(o => {
      if (o.status !== 'pending') return false;
      if (!o.order_date) return true;
      const orderDate = parseISO(o.order_date);
      return isWithinInterval(orderDate, { start: dateRange.from, end: dateRange.to });
    });

    // Calculate total needed per SKU
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

    // Calculate to buy and resolve supplier from Master Data
    return Object.entries(skuNeeds).map(([skuId, needed]) => {
      const sku = skus.find(s => s.id === skuId);
      const stock = currentStock.find(s => s.sku_id === skuId);
      const available = stock?.quantity_available || 0;
      const toBuy = Math.max(0, needed - available);

      // Resolve supplier from Master Data
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
        supplierResolved = (md?.supplier || md?.vendor || md?.Supplier || md?.brandSupplier || md?.vendorName || '').toString().trim()
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
        _debugSkuKey: skuKey,
        _debugMdMatch: !!md
      };
    }).filter(item => item.to_buy > 0);
  }, [orders, orderLines, skus, currentStock, suppliers, dateRange, masterLookup]);

  const handleSelectAll = () => {
    if (selectedSkus.length === purchaseNeeds.length) {
      setSelectedSkus([]);
    } else {
      setSelectedSkus(purchaseNeeds.map(p => p.sku_id));
    }
  };

  const handleToggleSelect = (skuId) => {
    if (selectedSkus.includes(skuId)) {
      setSelectedSkus(selectedSkus.filter(id => id !== skuId));
    } else {
      setSelectedSkus([...selectedSkus, skuId]);
    }
  };

  const handleAddToCart = async () => {
    if (selectedSkus.length === 0) {
      toast({ title: 'Select at least one SKU', variant: 'destructive' });
      return;
    }

    // Clear existing cart
    const existingCart = await base44.entities.PurchaseCart.filter({ tenant_id: tenantId });
    for (const item of existingCart) {
      await base44.entities.PurchaseCart.delete(item.id);
    }

    // Add selected items to cart
    for (const skuId of selectedSkus) {
      const need = purchaseNeeds.find(p => p.sku_id === skuId);
      if (need) {
        await base44.entities.PurchaseCart.create({
          tenant_id: tenantId,
          sku_id: skuId,
          sku_code: need.sku_code,
          product_name: need.product_name,
          quantity_needed: need.to_buy,
          suggested_supplier_id: need.supplier_id
        });
      }
    }

    toast({ 
      title: 'Added to Purchase Cart', 
      description: `${selectedSkus.length} items added. Go to Purchases to complete.` 
    });
    setSelectedSkus([]);
  };

  const totalValue = purchaseNeeds.reduce((sum, p) => sum + (p.to_buy * p.cost_price), 0);
  const totalItems = purchaseNeeds.reduce((sum, p) => sum + p.to_buy, 0);

  const handleExportToPDF = async () => {
    if (selectedSkus.length === 0) {
      toast({ title: 'No items selected', description: 'Please select SKUs to export', variant: 'destructive' });
      return;
    }

    toast({ title: 'Generating PDF...', description: 'Loading Master Data and preparing export' });

    try {
      // Safe text converter - ensures only strings/numbers, never objects
      const toStr = (value) => {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        if (typeof value === 'object') {
          return value.name || value.title || value.productName || value.nameAr || value.nameEN || value.arName || value.enName || '';
        }
        return String(value);
      };

      // AGGRESSIVE SKU normalization (remove spaces, RTL marks, hyphens, underscores, non-alphanumeric)
      const normalizeSku = (sku) => {
        const t = (sku ?? '').toString().trim();
        return t
          .replace(/[\s\r\n]+/g, '')
          .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
          .replace(/[-_]+/g, '')
          .replace(/[^0-9A-Za-z]+/g, '')
          .toUpperCase();
      };

      // Arabic text processing with RTL support
      const processArabicText = (text) => {
        const safe = toStr(text);
        if (!safe) return '';
        if (/[\u0600-\u06FF]/.test(safe)) {
          try {
            return bidi(safe);
          } catch (e) {
            console.warn('Bidi processing failed:', e);
            return safe;
          }
        }
        return safe;
      };

      // Load image as base64 with larger canvas
      const loadImageAsBase64 = (url) => {
        return new Promise((resolve) => {
          if (!url) {
            resolve(null);
            return;
          }
          const img = new Image();
          img.crossOrigin = 'Anonymous';
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = 80;
              canvas.height = 80;
              const ctx = canvas.getContext('2d');
              
              // Calculate aspect fit
              const aspectRatio = img.width / img.height;
              let drawWidth = 80;
              let drawHeight = 80;
              let offsetX = 0;
              let offsetY = 0;
              
              if (aspectRatio > 1) {
                drawHeight = 80 / aspectRatio;
                offsetY = (80 - drawHeight) / 2;
              } else {
                drawWidth = 80 * aspectRatio;
                offsetX = (80 - drawWidth) / 2;
              }
              
              ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
              resolve(canvas.toDataURL('image/jpeg', 0.8));
            } catch (e) {
              console.warn('Image conversion failed:', e);
              resolve(null);
            }
          };
          img.onerror = () => resolve(null);
          img.src = url;
        });
      };

      // Get Master Data (SKU entities) and other data
      const selectedItems = purchaseNeeds.filter(p => selectedSkus.includes(p.sku_id));
      const masterData = await base44.entities.SKU.filter({ tenant_id: tenantId });
      const suppliersData = await base44.entities.Supplier.filter({ tenant_id: tenantId });
      const tenantData = await base44.entities.Tenant.filter({ id: tenantId });
      const workspaceName = toStr(tenantData[0]?.name || 'Workspace');

      // Build Master Data lookup by normalized SKU
      const masterLookup = {};
      masterData.forEach(md => {
        const mdSkuKey = normalizeSku(md.sku_code || md.skuCode || md.sku || md['SKU CODE'] || md.itemSku || md.SKU || '');
        if (mdSkuKey) {
          masterLookup[mdSkuKey] = md;
        }
      });

      console.log('📊 Master Data lookup built:', Object.keys(masterLookup).length, 'SKUs indexed');
      if (debugMode) {
        console.log('🔍 DEBUG: First 5 master keys:', Object.keys(masterLookup).slice(0, 5));
      }

      let failedImagesCount = 0;

      // Use UI-resolved data directly (no re-joining, no re-mapping)
      const itemsWithData = await Promise.all(selectedItems.map(async (item) => {
        // Load image if available
        let imageData = null;
        const skuEntity = skus.find(s => s.id === item.sku_id);
        if (skuEntity?.image_url) {
          imageData = await loadImageAsBase64(skuEntity.image_url);
          if (!imageData) failedImagesCount++;
        }
        
        // Use UI-resolved values (already correct strings from purchaseNeeds)
        const supplierResolved = String(item.supplier || 'Unassigned');
        let productResolved = String(item.product_name || 'Unknown Product');
        
        // Safety check: ensure product is never an object
        if (typeof productResolved !== 'string') {
          productResolved = String(productResolved);
        }
        
        return {
          image: imageData,
          supplier: supplierResolved,
          skuCode: String(item.sku_code || ''),
          productName: productResolved,
          toBuy: Number(item.to_buy || 0),
          unitCost: Number(item.cost_price || 0),
          // Debug fields (pass through from UI)
          _debugSkuKey: item._debugSkuKey || '',
          _debugMdMatch: item._debugMdMatch || false
        };
      }));

      // Sort by supplier (Unassigned last)
      itemsWithData.sort((a, b) => {
        if (a.supplier === 'Unassigned') return 1;
        if (b.supplier === 'Unassigned') return -1;
        return (a.supplier || '').localeCompare(b.supplier || '', 'en', { sensitivity: 'base' });
      });

      console.log('✅ Enriched items:', itemsWithData.length, 'rows prepared');
      console.log('Sample row:', itemsWithData[0]);

      // Group by supplier
      const groupedBySupplier = itemsWithData.reduce((acc, item) => {
        if (!acc[item.supplier]) acc[item.supplier] = [];
        acc[item.supplier].push(item);
        return acc;
      }, {});

      const supplierNames = Object.keys(groupedBySupplier).sort((a, b) => {
        if (a === 'Unassigned') return 1;
        if (b === 'Unassigned') return -1;
        return a.localeCompare(b, 'ar', { sensitivity: 'base' });
      });

      // Headers (add debug columns if in debug mode)
      const headers = debugMode 
        ? ['IMAGE', 'SUPPLIER', 'SKU CODE', 'PRODUCT', 'TO BUY', 'UNIT COST', 'SKU_KEY', 'MD_MATCH']
        : ['IMAGE', 'SUPPLIER', 'SKU CODE', 'PRODUCT', 'TO BUY', 'UNIT COST'];

      // Generate PDFs based on mode
      if (exportMode === 'per-supplier') {
        // One PDF per supplier in ZIP
        const zip = new JSZip();
        const dateStr = format(new Date(), 'yyyy-MM-dd');

        for (const supplierName of supplierNames) {
          const items = groupedBySupplier[supplierName];
          const doc = new jsPDF();
          const pageWidth = doc.internal.pageSize.getWidth();

          // Header
          doc.setFontSize(20);
          doc.setFont('helvetica', 'bold');
          doc.text('Amazon OMS', 15, 20);
          
          doc.setFontSize(16);
          doc.text(`Purchase Request — ${supplierName}`, 15, 28);
          
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          doc.text(`Workspace: ${workspaceName}`, 15, 36);
          doc.text(`Date: ${format(new Date(), 'MMM d, yyyy')}`, pageWidth - 15, 20, { align: 'right' });
          
          if (dateRange?.from && dateRange?.to) {
            doc.text(
              `Period: ${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d, yyyy')}`,
              pageWidth - 15,
              28,
              { align: 'right' }
            );
          }

          // Build table rows - ensure all values are strings/numbers
          const tableRows = items.map(item => {
            const baseRow = [
              '', // Image placeholder
              String(item.supplier),
              String(item.skuCode),
              String(processArabicText(item.productName)),
              String(item.toBuy),
              String(`$${item.unitCost.toFixed(2)}`)
            ];
            
            if (debugMode) {
              baseRow.push(String(item._debugSkuKey || ''));
              baseRow.push(item._debugMdMatch ? 'YES' : 'NO');
            }
            
            return baseRow;
          });

          doc.autoTable({
            startY: 44,
            head: [headers],
            body: tableRows,
            theme: 'grid',
            headStyles: {
              fillColor: [79, 70, 229],
              textColor: 255,
              fontSize: 10,
              fontStyle: 'bold',
              halign: 'center',
              cellPadding: { top: 6, bottom: 6 }
            },
            styles: {
              fontSize: 9,
              cellPadding: { top: 8, bottom: 8, left: 4, right: 4 },
              halign: 'center',
              lineColor: [200, 200, 200],
              lineWidth: 0.5,
              minCellHeight: 32
            },
            columnStyles: debugMode ? {
              0: { cellWidth: 20, halign: 'center' }, // IMAGE
              1: { cellWidth: 25, halign: 'left' },   // SUPPLIER
              2: { cellWidth: 18, halign: 'center' }, // SKU CODE
              3: { cellWidth: 35, halign: 'right' },  // PRODUCT (RTL)
              4: { cellWidth: 15, halign: 'center' }, // TO BUY
              5: { cellWidth: 20, halign: 'right' },  // UNIT COST
              6: { cellWidth: 25, halign: 'left', fontSize: 7 },   // SKU_KEY
              7: { cellWidth: 15, halign: 'center', fontSize: 7 }  // MD_MATCH
            } : {
              0: { cellWidth: 28, halign: 'center' }, // IMAGE (wider)
              1: { cellWidth: 30, halign: 'left' },   // SUPPLIER
              2: { cellWidth: 22, halign: 'center' }, // SKU CODE
              3: { cellWidth: 48, halign: 'right' },  // PRODUCT (RTL)
              4: { cellWidth: 18, halign: 'center' }, // TO BUY
              5: { cellWidth: 26, halign: 'right' }   // UNIT COST
            },
            didDrawCell: (data) => {
              // Render images in first column (larger)
              if (data.column.index === 0 && data.cell.section === 'body') {
                const item = items[data.row.index];
                if (item?.image) {
                  try {
                    const imgSize = 24;
                    const x = data.cell.x + (data.cell.width - imgSize) / 2;
                    const y = data.cell.y + (data.cell.height - imgSize) / 2;
                    doc.addImage(item.image, 'JPEG', x, y, imgSize, imgSize);
                  } catch (e) {
                    console.error('Image render error:', e);
                  }
                }
              }
            }
          });

          // Totals
          const supplierTotal = items.reduce((sum, item) => sum + (item.toBuy * item.unitCost), 0);
          const supplierItemCount = items.reduce((sum, item) => sum + item.toBuy, 0);
          
          const finalY = doc.lastAutoTable.finalY + 10;
          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          doc.text(`Total Items: ${supplierItemCount}`, pageWidth - 15, finalY, { align: 'right' });
          doc.text(`Total Cost: $${supplierTotal.toFixed(2)}`, pageWidth - 15, finalY + 7, { align: 'right' });

          // Add to ZIP
          const pdfBlob = doc.output('blob');
          const safeFileName = supplierName.replace(/[^a-z0-9\u0600-\u06FF]/gi, '_');
          zip.file(`Purchase_Request_${safeFileName}_${dateStr}.pdf`, pdfBlob);
        }

        // Download ZIP
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(zipBlob);
        link.download = `Purchase_Requests_${format(new Date(), 'yyyy-MM-dd')}.zip`;
        link.click();
        URL.revokeObjectURL(link.href);
        
        toast({ 
          title: 'PDFs Generated', 
          description: `${supplierNames.length} suppliers • ${itemsWithData.length} items${failedImagesCount > 0 ? ` • ${failedImagesCount} images failed` : ''}`,
          duration: 4000
        });

      } else {
        // Single PDF with page breaks per supplier
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();

        // Main header
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.text('Amazon OMS', 15, 20);
        
        doc.setFontSize(16);
        doc.text('Purchase Requests', 15, 28);
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(`Workspace: ${workspaceName}`, 15, 36);
        doc.text(`Date: ${format(new Date(), 'MMM d, yyyy')}`, pageWidth - 15, 20, { align: 'right' });
        
        if (dateRange?.from && dateRange?.to) {
          doc.text(
            `Period: ${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d, yyyy')}`,
            pageWidth - 15,
            28,
            { align: 'right' }
          );
        }

        let isFirstSupplier = true;
        for (const supplierName of supplierNames) {
          const items = groupedBySupplier[supplierName];
          
          // Page break for each supplier (except first)
          if (!isFirstSupplier) {
            doc.addPage();
          }
          isFirstSupplier = false;

          // Supplier section header
          const startY = doc.lastAutoTable ? 20 : 44;
          doc.setFontSize(14);
          doc.setFont('helvetica', 'bold');
          doc.setFillColor(79, 70, 229);
          doc.setTextColor(255, 255, 255);
          doc.rect(15, startY, pageWidth - 30, 10, 'F');
          
          const supplierTotal = items.reduce((sum, item) => sum + (item.toBuy * item.unitCost), 0);
          const supplierItemCount = items.reduce((sum, item) => sum + item.toBuy, 0);
          
          doc.text(
            `${supplierName} • ${items.length} SKUs • ${supplierItemCount} items • $${supplierTotal.toFixed(2)}`,
            pageWidth / 2,
            startY + 7,
            { align: 'center' }
          );
          doc.setTextColor(0, 0, 0);

          // Table
          const tableRows = items.map(item => {
            const baseRow = [
              '', // Image
              String(item.supplier),
              String(item.skuCode),
              String(processArabicText(item.productName)),
              String(item.toBuy),
              String(`$${item.unitCost.toFixed(2)}`)
            ];
            
            if (debugMode) {
              baseRow.push(String(item._debugSkuKey || ''));
              baseRow.push(item._debugMdMatch ? 'YES' : 'NO');
            }
            
            return baseRow;
          });

          doc.autoTable({
            startY: startY + 12,
            head: [headers],
            body: tableRows,
            theme: 'grid',
            headStyles: {
              fillColor: [99, 102, 241],
              textColor: 255,
              fontSize: 10,
              fontStyle: 'bold',
              halign: 'center',
              cellPadding: { top: 6, bottom: 6 }
            },
            styles: {
              fontSize: 9,
              cellPadding: { top: 8, bottom: 8, left: 4, right: 4 },
              halign: 'center',
              lineColor: [200, 200, 200],
              lineWidth: 0.5,
              minCellHeight: 32
            },
            columnStyles: debugMode ? {
              0: { cellWidth: 20, halign: 'center' },
              1: { cellWidth: 25, halign: 'left' },
              2: { cellWidth: 18, halign: 'center' },
              3: { cellWidth: 35, halign: 'right' },
              4: { cellWidth: 15, halign: 'center' },
              5: { cellWidth: 20, halign: 'right' },
              6: { cellWidth: 25, halign: 'left', fontSize: 7 },
              7: { cellWidth: 15, halign: 'center', fontSize: 7 }
            } : {
              0: { cellWidth: 28, halign: 'center' },
              1: { cellWidth: 30, halign: 'left' },
              2: { cellWidth: 22, halign: 'center' },
              3: { cellWidth: 48, halign: 'right' },
              4: { cellWidth: 18, halign: 'center' },
              5: { cellWidth: 26, halign: 'right' }
            },
            didDrawCell: (data) => {
              if (data.column.index === 0 && data.cell.section === 'body') {
                const item = items[data.row.index];
                if (item?.image) {
                  try {
                    const imgSize = 24;
                    const x = data.cell.x + (data.cell.width - imgSize) / 2;
                    const y = data.cell.y + (data.cell.height - imgSize) / 2;
                    doc.addImage(item.image, 'JPEG', x, y, imgSize, imgSize);
                  } catch (e) {
                    console.error('Image render error:', e);
                  }
                }
              }
            }
          });
        }

        // Grand total
        const grandTotal = itemsWithData.reduce((sum, item) => sum + (item.toBuy * item.unitCost), 0);
        const grandTotalItems = itemsWithData.reduce((sum, item) => sum + item.toBuy, 0);

        const finalY = doc.lastAutoTable.finalY + 12;
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(`GRAND TOTAL: ${grandTotalItems} items • $${grandTotal.toFixed(2)}`, pageWidth - 15, finalY, { align: 'right' });

        // Save
        doc.save(`Purchase_Requests_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
        
        toast({ 
          title: 'PDF Generated', 
          description: `${supplierNames.length} suppliers • ${itemsWithData.length} items${failedImagesCount > 0 ? ` • ${failedImagesCount} images failed` : ''}`,
          duration: 4000
        });
      }

    } catch (error) {
      console.error('❌ PDF export failed:', error);
      toast({ 
        title: 'Export Failed', 
        description: `${error.message}. See console for details.`,
        variant: 'destructive',
        duration: 6000
      });
    }
  };

  const columns = [
    {
      key: 'select',
      header: (
        <Checkbox
          checked={selectedSkus.length === purchaseNeeds.length && purchaseNeeds.length > 0}
          onCheckedChange={handleSelectAll}
        />
      ),
      render: (_, row) => (
        <Checkbox
          checked={selectedSkus.includes(row.sku_id)}
          onCheckedChange={() => handleToggleSelect(row.sku_id)}
        />
      )
    },
    {
      key: 'sku_code',
      header: 'SKU Code',
      sortable: true,
      render: (val, row) => (
        <div>
          <span className="font-medium text-slate-900">{val}</span>
          {debugMode && (
            <div className="text-xs text-slate-400 mt-1">
              Key: {row._debugSkuKey} • Match: {row._debugMdMatch ? '✅ YES' : '❌ NO'}
            </div>
          )}
        </div>
      )
    },
    {
      key: 'supplier',
      header: 'Supplier',
      sortable: true,
      render: (val) => (
        <span className={val === 'Unassigned' ? 'text-slate-400 italic' : 'text-slate-700'}>
          {val}
        </span>
      )
    },
    {
      key: 'product_name',
      header: 'Product',
      sortable: true
    },
    {
      key: 'total_needed',
      header: 'Needed',
      align: 'right',
      render: (val) => <span className="font-semibold text-amber-600">{val}</span>
    },
    {
      key: 'available',
      header: 'In Stock',
      align: 'right',
      render: (val) => <span className={val > 0 ? 'text-emerald-600' : 'text-slate-400'}>{val}</span>
    },
    {
      key: 'to_buy',
      header: 'To Buy',
      align: 'right',
      render: (val) => <span className="font-bold text-indigo-600">{val}</span>
    },
    {
      key: 'cost_price',
      header: 'Unit Cost',
      align: 'right',
      render: (val) => `$${(val || 0).toFixed(2)}`
    },
    {
      key: 'estimated_cost',
      header: 'Est. Total',
      align: 'right',
      render: (_, row) => (
        <span className="font-medium">${(row.to_buy * row.cost_price).toFixed(2)}</span>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <PaywallBanner subscription={subscription} onUpgrade={() => {}} />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Purchase Requests</h1>
          <p className="text-slate-500">Calculate inventory needs for pending orders</p>
        </div>
        <RefreshButton onRefresh={() => loadData(true)} loading={refreshing} />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl p-6 text-white">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-white/20 rounded-lg">
              <Calculator className="w-5 h-5" />
            </div>
            <span className="text-white/80">SKUs to Order</span>
          </div>
          <p className="text-3xl font-bold">{purchaseNeeds.length}</p>
        </div>

        <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl p-6 text-white">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-white/20 rounded-lg">
              <ClipboardList className="w-5 h-5" />
            </div>
            <span className="text-white/80">Total Items</span>
          </div>
          <p className="text-3xl font-bold">{totalItems}</p>
        </div>

        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-6 text-white">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-white/20 rounded-lg">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <span className="text-white/80">Estimated Cost</span>
          </div>
          <p className="text-3xl font-bold">${totalValue.toLocaleString()}</p>
        </div>
      </div>

      {/* Date Range Filter */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-slate-900">Order Date Range</h3>
            <p className="text-sm text-slate-500">Calculate needs for pending orders in this period</p>
          </div>
          <div className="flex items-center gap-4">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">
                  <CalendarIcon className="w-4 h-4 mr-2" />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, 'MMM d')} - {format(dateRange.to, 'MMM d, yyyy')}
                      </>
                    ) : (
                      format(dateRange.from, 'MMM d, yyyy')
                    )
                  ) : (
                    'Pick dates'
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>

      {/* Action Bar */}
      {selectedSkus.length > 0 && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-indigo-700 font-medium">
              {selectedSkus.length} SKU(s) selected
            </p>
            <div className="flex items-center gap-3">
              <Button 
                onClick={handleExportToPDF}
                variant="outline"
                className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
              >
                <FileDown className="w-4 h-4 mr-2" />
                Export to PDF
              </Button>
              <Button 
                onClick={handleAddToCart}
                className="bg-indigo-600 hover:bg-indigo-700"
                disabled={!isActive}
              >
                <ShoppingCart className="w-4 h-4 mr-2" />
                Add to Purchase Cart
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-600">Export mode:</span>
            <button
              onClick={() => setExportMode('single')}
              className={`px-3 py-1 rounded-md transition-colors ${
                exportMode === 'single'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-200'
              }`}
            >
              Single PDF (All)
            </button>
            <button
              onClick={() => setExportMode('per-supplier')}
              className={`px-3 py-1 rounded-md transition-colors ${
                exportMode === 'per-supplier'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-200'
              }`}
            >
              PDF per Supplier (ZIP)
            </button>
            <button
              onClick={() => setDebugMode(!debugMode)}
              className={`px-3 py-1 rounded-md transition-colors ${
                debugMode
                  ? 'bg-red-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-red-200'
              }`}
            >
              {debugMode ? '🐛 Debug ON' : 'Debug Mode'}
            </button>
          </div>
        </div>
      )}

      {/* Needs Table */}
      <DataTable
        columns={columns}
        data={purchaseNeeds}
        loading={loading}
        emptyIcon={ClipboardList}
        emptyTitle="No purchase needs"
        emptyDescription="All pending orders are covered by current stock"
      />
    </div>
  );
}