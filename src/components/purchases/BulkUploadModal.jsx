import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { Upload, FileText, AlertTriangle, CheckCircle, XCircle, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Progress } from '@/components/ui/progress';

export default function BulkUploadModal({ open, onClose, tenantId, onSuccess }) {
  const { toast } = useToast();
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.type === 'text/csv') {
      setFile(selectedFile);
      setResult(null);
    } else {
      toast({ 
        title: 'Invalid file type', 
        description: 'Please select a CSV file',
        variant: 'destructive' 
      });
    }
  };

  const normalizeHeader = (header) => {
    // Normalize header: lowercase, remove spaces/underscores
    const normalized = header.toLowerCase().replace(/[\s_]+/g, '');
    
    // Map to canonical keys
    const headerMap = {
      'skucode': 'sku_code',
      'unitprice': 'unit_price',
      'suppliername': 'supplier_name',
      'quantity': 'quantity',
      'purchasedate': 'purchase_date'
    };
    
    return headerMap[normalized] || normalized;
  };

  const parseCSV = (text) => {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];

    const rawHeaders = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const headers = rawHeaders.map(h => normalizeHeader(h));
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const values = [];
      let current = '';
      let inQuotes = false;

      for (let j = 0; j < lines[i].length; j++) {
        const char = lines[i][j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim().replace(/^"|"$/g, ''));
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim().replace(/^"|"$/g, ''));

      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      rows.push(row);
    }

    return rows;
  };

  const handleUpload = async () => {
    if (!file) {
      toast({ title: 'No file selected', variant: 'destructive' });
      return;
    }

    setUploading(true);
    setProgress(0);
    setResult(null);

    try {
      // Read file with UTF-8-sig encoding support
      const text = await file.text();
      const textUtf8 = text.replace(/^\uFEFF/, ''); // Remove BOM if present
      const rows = parseCSV(textUtf8);

      if (rows.length === 0) {
        toast({ title: 'Empty CSV file', variant: 'destructive' });
        setUploading(false);
        return;
      }

      // Preload SKUs, Suppliers, and recent Purchases for efficient lookup
      const skus = await base44.entities.SKU.filter({ tenant_id: tenantId });
      const suppliers = await base44.entities.Supplier.filter({ tenant_id: tenantId });
      const allPurchases = await base44.entities.Purchase.filter({ tenant_id: tenantId });
      
      // Create lookup maps
      const skuMap = {};
      skus.forEach(sku => {
        skuMap[sku.sku_code?.trim()?.toLowerCase()] = {
          id: sku.id,
          sku_code: sku.sku_code,
          cost_price: sku.cost_price,
          supplier_id: sku.supplier_id,
          product_name: sku.product_name,
          image_url: sku.image_url
        };
      });

      const supplierMap = {};
      suppliers.forEach(supplier => {
        supplierMap[supplier.id] = supplier.supplier_name;
      });

      // Create map of most recent purchase cost AND supplier per SKU
      const lastPurchaseDataMap = {};
      allPurchases.forEach(purchase => {
        const skuKey = purchase.sku_code?.trim()?.toLowerCase();
        if (skuKey) {
          if (!lastPurchaseDataMap[skuKey] || 
              new Date(purchase.purchase_date) > new Date(lastPurchaseDataMap[skuKey].date)) {
            lastPurchaseDataMap[skuKey] = {
              cost: purchase.cost_per_unit > 0 ? purchase.cost_per_unit : null,
              supplier_name: purchase.supplier_name || null,
              supplier_id: purchase.supplier_id || null,
              date: purchase.purchase_date
            };
          }
        }
      });

      // Create batch record
      const batch = await base44.entities.ImportBatch.create({
        tenant_id: tenantId,
        batch_type: 'purchases',
        batch_name: `purchases_${format(new Date(), 'yyyyMMdd_HHmmss')}`,
        filename: file.name,
        status: 'processing',
        total_rows: rows.length,
        success_rows: 0,
        failed_rows: 0
      });

      const results = {
        total: rows.length,
        success: 0,
        failed: 0,
        errors: []
      };

      // Process each row
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = i + 1;
        
        setProgress(Math.round(((i + 1) / rows.length) * 100));

        try {
          // 1. Validate and lookup SKU
          const skuCodeRaw = row.sku_code?.trim();
          if (!skuCodeRaw) {
            throw new Error('SKU code is required');
          }

          const skuData = skuMap[skuCodeRaw.toLowerCase()];
          if (!skuData) {
            throw new Error('SKU not found');
          }

          // Get historical purchase data for this SKU
          const lastPurchaseData = lastPurchaseDataMap[skuCodeRaw.toLowerCase()];

          // 2. RESOLVE unit_price BEFORE validation
          const originalUnitPrice = row.unit_price?.trim();
          let unitPrice = parseFloat(originalUnitPrice);
          let unitPriceSource = 'csv';
          let skuCostCandidate = skuData.cost_price > 0 ? skuData.cost_price : null;
          let lastPurchaseCostCandidate = lastPurchaseData?.cost || null;
          let resolvedUnitPrice = null;
          
          if (isNaN(unitPrice) || !originalUnitPrice) {
            // Resolve candidate prices
            if (skuCostCandidate && lastPurchaseCostCandidate) {
              // Both available: use minimum
              resolvedUnitPrice = Math.min(skuCostCandidate, lastPurchaseCostCandidate);
              unitPriceSource = 'min(sku_cost,last_purchase)';
            } else if (skuCostCandidate) {
              // Only SKU cost available
              resolvedUnitPrice = skuCostCandidate;
              unitPriceSource = 'sku_cost';
            } else if (lastPurchaseCostCandidate) {
              // Only last purchase cost available
              resolvedUnitPrice = lastPurchaseCostCandidate;
              unitPriceSource = 'last_purchase';
            } else {
              throw new Error('Missing unit_price and no fallback price available');
            }
            unitPrice = resolvedUnitPrice;
          } else {
            resolvedUnitPrice = unitPrice;
          }

          // 3. RESOLVE supplier_name BEFORE validation
          const originalSupplierName = row.supplier_name?.trim();
          let supplierName = originalSupplierName || null;
          let supplierId = null;
          let supplierSource = 'csv';
          let resolvedSupplierName = null;

          if (!supplierName) {
            // Fallback priority: SKU master -> Last purchase
            if (skuData.supplier_id && supplierMap[skuData.supplier_id]) {
              supplierId = skuData.supplier_id;
              resolvedSupplierName = supplierMap[skuData.supplier_id];
              supplierSource = 'sku_master';
            } else if (lastPurchaseData?.supplier_name) {
              resolvedSupplierName = lastPurchaseData.supplier_name;
              supplierId = lastPurchaseData.supplier_id;
              supplierSource = 'last_purchase';
            } else {
              resolvedSupplierName = null;
              supplierSource = 'unresolved';
            }
            supplierName = resolvedSupplierName;
          } else {
            resolvedSupplierName = supplierName;
            // Find supplier ID from name
            const supplier = suppliers.find(s => 
              s.supplier_name?.toLowerCase() === supplierName.toLowerCase()
            );
            if (supplier) {
              supplierId = supplier.id;
            }
          }

          // 4. NOW validate quantity
          const quantity = parseInt(row.quantity);
          if (isNaN(quantity) || quantity < 1) {
            throw new Error('Invalid quantity (must be >= 1)');
          }

          // 5. Purchase date (default to today if missing)
          let purchaseDate = row.purchase_date?.trim();
          if (!purchaseDate) {
            purchaseDate = format(new Date(), 'yyyy-MM-dd');
          }

          // Create purchase record (NEVER save empty string for supplier)
          const totalCost = quantity * unitPrice;
          
          await base44.entities.Purchase.create({
            tenant_id: tenantId,
            sku_id: skuData.id,
            sku_code: skuData.sku_code,
            quantity_purchased: quantity,
            total_cost: totalCost,
            cost_per_unit: unitPrice,
            purchase_date: purchaseDate,
            supplier_id: supplierId || null,
            supplier_name: supplierName || null,
            quantity_remaining: quantity,
            import_batch_id: batch.id
          });

          // Update current stock
          const existingStock = await base44.entities.CurrentStock.filter({
            tenant_id: tenantId,
            sku_id: skuData.id
          });

          if (existingStock.length > 0) {
            await base44.entities.CurrentStock.update(existingStock[0].id, {
              quantity_available: (existingStock[0].quantity_available || 0) + quantity
            });
          } else {
            await base44.entities.CurrentStock.create({
              tenant_id: tenantId,
              sku_id: skuData.id,
              sku_code: skuData.sku_code,
              quantity_available: quantity
            });
          }

          // Create stock movement
          const movementNotes = [
            `Batch import: ${batch.batch_name}`,
            unitPriceSource !== 'csv' ? `Price source: ${unitPriceSource}` : null,
            supplierSource !== 'csv' ? `Supplier source: ${supplierSource}` : null,
            !supplierName ? 'Warning: Supplier unresolved' : null
          ].filter(Boolean).join(' | ');

          await base44.entities.StockMovement.create({
            tenant_id: tenantId,
            sku_id: skuData.id,
            sku_code: skuData.sku_code,
            movement_type: 'purchase',
            quantity: quantity,
            reference_type: 'batch',
            reference_id: batch.id,
            movement_date: purchaseDate,
            notes: movementNotes
          });

          results.success++;
        } catch (error) {
          results.failed++;
          
          // Detailed error diagnostics
          const skuData = skuMap[row.sku_code?.trim()?.toLowerCase()];
          const lastPurchaseData = lastPurchaseDataMap[row.sku_code?.trim()?.toLowerCase()];
          
          const skuCostCandidate = skuData?.cost_price > 0 ? skuData.cost_price : null;
          const lastPurchaseCostCandidate = lastPurchaseData?.cost || null;
          
          let errorUnitPriceSource = 'csv';
          let resolvedUnitPrice = row.unit_price?.trim() || '';
          
          if (!row.unit_price?.trim()) {
            if (skuCostCandidate && lastPurchaseCostCandidate) {
              errorUnitPriceSource = 'min(sku_cost,last_purchase)';
              resolvedUnitPrice = Math.min(skuCostCandidate, lastPurchaseCostCandidate);
            } else if (skuCostCandidate) {
              errorUnitPriceSource = 'sku_cost';
              resolvedUnitPrice = skuCostCandidate;
            } else if (lastPurchaseCostCandidate) {
              errorUnitPriceSource = 'last_purchase';
              resolvedUnitPrice = lastPurchaseCostCandidate;
            } else {
              errorUnitPriceSource = 'none_available';
              resolvedUnitPrice = '';
            }
          }

          let errorSupplierSource = 'csv';
          let resolvedSupplierName = row.supplier_name?.trim() || '';
          
          if (!row.supplier_name?.trim()) {
            if (skuData?.supplier_id && supplierMap[skuData.supplier_id]) {
              errorSupplierSource = 'sku_master';
              resolvedSupplierName = supplierMap[skuData.supplier_id];
            } else if (lastPurchaseData?.supplier_name) {
              errorSupplierSource = 'last_purchase';
              resolvedSupplierName = lastPurchaseData.supplier_name;
            } else {
              errorSupplierSource = 'unresolved';
              resolvedSupplierName = '';
            }
          }
          
          results.errors.push({
            row: rowNumber,
            data: row,
            error: error.message,
            original_unit_price: row.unit_price?.trim() || '',
            resolved_unit_price: resolvedUnitPrice,
            unit_price_source: errorUnitPriceSource,
            sku_cost_candidate: skuCostCandidate || '',
            last_purchase_cost_candidate: lastPurchaseCostCandidate || '',
            original_supplier_name: row.supplier_name?.trim() || '',
            resolved_supplier_name: resolvedSupplierName,
            supplier_source: errorSupplierSource
          });

          // Log error to database
          await base44.entities.ImportError.create({
            tenant_id: tenantId,
            batch_id: batch.id,
            row_number: rowNumber,
            raw_row_json: JSON.stringify(row),
            error_reason: error.message
          });
        }
      }

      // Update batch status
      await base44.entities.ImportBatch.update(batch.id, {
        status: results.failed === 0 ? 'success' : (results.success > 0 ? 'partial' : 'failed'),
        success_rows: results.success,
        failed_rows: results.failed
      });

      // Generate error CSV if there are failures
      if (results.errors.length > 0) {
        const errorCsvContent = generateErrorCSV(results.errors);
        const blob = new Blob(['\uFEFF' + errorCsvContent], { type: 'text/csv;charset=utf-8;' });
        const errorFileUrl = URL.createObjectURL(blob);
        
        await base44.entities.ImportBatch.update(batch.id, {
          error_file_url: errorFileUrl
        });
      }

      setResult(results);
      
      toast({
        title: 'Import completed',
        description: `${results.success} succeeded, ${results.failed} failed`
      });

      if (results.success > 0) {
        onSuccess();
      }

    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: 'Upload failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setUploading(false);
    }
  };

  const generateErrorCSV = (errors) => {
    if (errors.length === 0) return '';

    const headers = [
      'row',
      'sku_code',
      'quantity',
      'original_unit_price',
      'resolved_unit_price',
      'unit_price_source',
      'sku_cost_candidate',
      'last_purchase_cost_candidate',
      'original_supplier_name',
      'resolved_supplier_name',
      'supplier_source',
      'purchase_date',
      'error_reason'
    ];

    const rows = errors.map(e => [
      e.row,
      e.data.sku_code || '',
      e.data.quantity || '',
      e.original_unit_price,
      e.resolved_unit_price,
      e.unit_price_source,
      e.sku_cost_candidate,
      e.last_purchase_cost_candidate,
      e.original_supplier_name,
      e.resolved_supplier_name,
      e.supplier_source,
      e.data.purchase_date || '',
      e.error
    ]);

    const escapeCsvCell = (value) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    return [
      headers.map(h => escapeCsvCell(h)).join(','),
      ...rows.map(row => row.map(cell => escapeCsvCell(cell)).join(','))
    ].join('\n');
  };

  const downloadErrorCSV = () => {
    if (!result || result.errors.length === 0) return;

    const csvContent = generateErrorCSV(result.errors);
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `purchase_import_errors_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadTemplate = () => {
    const template = [
      'sku_code,quantity,unit_price,supplier_name,purchase_date',
      'SKU001,10,15.50,Supplier A,2026-02-09',
      'SKU002,5,,Warehouse,2026-02-09',
      'SKU003,20,,,2026-02-09'
    ].join('\n');

    const blob = new Blob(['\uFEFF' + template], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'purchases_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClose = () => {
    setFile(null);
    setResult(null);
    setProgress(0);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk Upload Purchases</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!result ? (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 mb-2">CSV Format Requirements:</h4>
                <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                  <li><strong>sku_code</strong> - Required (must exist in system)</li>
                  <li><strong>quantity</strong> - Required (number of units)</li>
                  <li><strong>unit_price</strong> - Required (cost per unit)</li>
                  <li><strong>supplier_name</strong> - Optional (defaults to "Generic")</li>
                  <li><strong>purchase_date</strong> - Optional (format: YYYY-MM-DD, defaults to today)</li>
                </ul>
              </div>

              <Button onClick={downloadTemplate} variant="outline" className="w-full">
                <Download className="w-4 h-4 mr-2" />
                Download CSV Template
              </Button>

              <div className="space-y-2">
                <Label htmlFor="batch-name">Batch Name (Optional)</Label>
                <Input
                  id="batch-name"
                  placeholder="e.g., Main Warehouse - Jan 2026"
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value)}
                  maxLength={80}
                />
                <p className="text-xs text-slate-500">Give this batch a recognizable name for easier tracking</p>
              </div>

              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="hidden"
                  id="csv-upload"
                />
                <label htmlFor="csv-upload" className="cursor-pointer">
                  <Upload className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-600 mb-1">
                    {file ? file.name : 'Click to upload CSV file'}
                  </p>
                  <p className="text-sm text-gray-400">CSV files only</p>
                </label>
              </div>

              <div className="flex gap-3">
                <Button onClick={handleClose} variant="outline" className="flex-1">
                  Cancel
                </Button>
                <Button 
                  onClick={handleUpload} 
                  disabled={!file || uploading}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                >
                  {uploading ? 'Uploading...' : 'Upload & Process'}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-green-900">Upload Complete</h4>
                    <p className="text-sm text-green-700 mt-1">
                      Processed {result.total} rows into {result.uniqueRecords} unique purchase record(s)
                    </p>
                    <p className="text-sm text-green-700">
                      Stock updated for {result.skusUpdated} SKU(s)
                    </p>
                  </div>
                </div>

                {result.errors > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
                    <div className="flex-1">
                      <h4 className="font-medium text-amber-900">
                        {result.errors} row(s) failed
                      </h4>
                      <p className="text-sm text-amber-700 mt-1">
                        Download the error CSV to review and fix the issues
                      </p>
                    </div>
                  </div>
                )}

                <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Total Rows:</span>
                    <span className="font-medium">{result.total}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-green-600">Successful:</span>
                    <span className="font-medium text-green-600">{result.success}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-amber-600">Failed:</span>
                    <span className="font-medium text-amber-600">{result.errors}</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                {result.errors > 0 && (
                  <Button 
                    onClick={downloadErrorCSV} 
                    variant="outline"
                    className="flex-1"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Error CSV
                  </Button>
                )}
                <Button onClick={handleClose} className="flex-1 bg-indigo-600 hover:bg-indigo-700">
                  Done
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}