import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, Download, AlertCircle, CheckCircle, X, ArrowRight } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { base44 } from '@/api/base44Client';
import { resolveOrCreateSupplier } from './supplierResolver';
import { Progress } from '@/components/ui/progress';

export default function BulkUpdateModal({ open, onClose, onComplete, tenantId }) {
  const { toast } = useToast();
  const [file, setFile] = useState(null);
  const [step, setStep] = useState('upload'); // 'upload', 'fields', 'preview', 'processing', 'complete'
  const [detectedColumns, setDetectedColumns] = useState([]);
  const [selectedFields, setSelectedFields] = useState({
    supplier: false,
    cost: false,
    stock: false,
    product_name: false,
    image_url: false
  });
  const [previewData, setPreviewData] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, successCount: 0, failCount: 0 });
  const [result, setResult] = useState(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      if (!selectedFile.name.endsWith('.csv')) {
        toast({
          title: 'Invalid file type',
          description: 'Please upload a CSV file',
          variant: 'destructive'
        });
        return;
      }
      setFile(selectedFile);
    }
  };

  const downloadTemplate = () => {
    const template = 'sku_code,supplier,cost,stock,product_name,image_url\nWGT-001,Wholesale Mart,15.50,100,Wireless Earbuds Pro,https://example.com/image.jpg';
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sku_bulk_update_template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const normalizeHeader = (header) => {
    const normalized = header.toLowerCase().trim().replace(/[\s_-]+/g, '');
    
    // Map variations to standard names
    const headerMap = {
      'skucode': 'sku_code',
      'sku': 'sku_code',
      'supplier': 'supplier',
      'suppliername': 'supplier',
      'supplierid': 'supplier',
      'cost': 'cost',
      'unitcost': 'cost',
      'price': 'cost',
      'stock': 'stock',
      'initialstock': 'stock',
      'quantity': 'stock',
      'productname': 'product_name',
      'name': 'product_name',
      'imageurl': 'image_url',
      'image': 'image_url'
    };
    
    return headerMap[normalized] || header;
  };

  const parseCSV = (text) => {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length < 2) return { rows: [], headers: [], rawHeaders: [] };

    const rawHeaders = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
    const headers = rawHeaders.map(normalizeHeader);
    
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
      const row = {};
      headers.forEach((header, idx) => {
        if (values[idx] !== undefined && values[idx] !== '') {
          row[header] = values[idx];
        }
      });
      
      // Only include rows with sku_code
      if (row.sku_code) {
        rows.push(row);
      }
    }
    
    return { rows, headers, rawHeaders };
  };

  const handleDetectColumns = async () => {
    if (!file) return;

    try {
      const text = await file.text();
      const { rows, headers, rawHeaders } = parseCSV(text);

      if (rows.length === 0) {
        throw new Error('CSV file is empty or has no valid rows with sku_code');
      }

      // Detect which columns are present (excluding sku_code)
      const detected = headers.filter(h => h !== 'sku_code');
      setDetectedColumns(detected);

      // Auto-select fields based on what's in CSV
      const autoSelect = {
        supplier: detected.includes('supplier'),
        cost: detected.includes('cost'),
        stock: detected.includes('stock'),
        product_name: detected.includes('product_name'),
        image_url: detected.includes('image_url')
      };
      setSelectedFields(autoSelect);

      setStep('fields');
    } catch (error) {
      toast({
        title: 'Failed to read file',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handlePreview = async () => {
    try {
      const text = await file.text();
      const { rows } = parseCSV(text);

      if (rows.length === 0) {
        throw new Error('CSV file is empty or has no valid rows with sku_code');
      }

      // Fetch all SKUs and suppliers for this workspace
      const [allSKUs, allSuppliers] = await Promise.all([
        base44.entities.SKU.filter({ tenant_id: tenantId }),
        base44.entities.Supplier.filter({ tenant_id: tenantId })
      ]);

      // Build lookup maps
      const skuMap = new Map();
      allSKUs.forEach(sku => {
        skuMap.set(sku.sku_code.toLowerCase().trim(), sku);
      });

      const supplierCache = new Map();
      allSuppliers.forEach(sup => {
        supplierCache.set(sup.id, sup);
        supplierCache.set(sup.supplier_name.toLowerCase().trim(), sup);
      });

      // Preview changes
      const preview = [];
      let willUpdateCount = 0;
      let willFailCount = 0;

      for (const row of rows) {
        const skuCode = row.sku_code.trim();
        const existingSKU = skuMap.get(skuCode.toLowerCase());

        if (!existingSKU) {
          preview.push({
            sku_code: skuCode,
            status: 'fail',
            error: 'SKU not found'
          });
          willFailCount++;
          continue;
        }

        const changes = {};
        let hasChanges = false;

        // Check supplier - ONLY if selected
        if (selectedFields.supplier && row.supplier) {
          const supplierValue = row.supplier.trim();
          try {
            // Try to resolve supplier
            let foundSupplier = null;
            
            // Try ID first
            if (supplierCache.has(supplierValue)) {
              foundSupplier = supplierCache.get(supplierValue);
            } else {
              // Try name (case-insensitive)
              const nameLower = supplierValue.toLowerCase();
              for (let [key, supplier] of supplierCache) {
                if (typeof key === 'string' && key.toLowerCase() === nameLower) {
                  foundSupplier = supplier;
                  break;
                }
              }
            }
            
            if (!foundSupplier) {
              changes.supplier = { old: existingSKU.supplier_id || '-', new: `${supplierValue} (new)` };
              hasChanges = true;
            } else if (foundSupplier.id !== existingSKU.supplier_id) {
              changes.supplier = { old: existingSKU.supplier_id || '-', new: foundSupplier.supplier_name };
              hasChanges = true;
            }
          } catch (err) {
            preview.push({
              sku_code: skuCode,
              status: 'fail',
              error: `Supplier error: ${err.message}`
            });
            willFailCount++;
            continue;
          }
        }

        // Check cost - ONLY if selected
        if (selectedFields.cost && row.cost !== undefined) {
          const newCost = parseFloat(row.cost);
          if (isNaN(newCost) || newCost <= 0) {
            preview.push({
              sku_code: skuCode,
              status: 'fail',
              error: 'Invalid cost value'
            });
            willFailCount++;
            continue;
          }
          if (newCost !== existingSKU.cost_price) {
            changes.cost = { old: existingSKU.cost_price, new: newCost };
            hasChanges = true;
          }
        }

        // Check stock - ONLY if selected
        if (selectedFields.stock && row.stock !== undefined) {
          const newStock = parseInt(row.stock);
          if (isNaN(newStock) || newStock < 0) {
            preview.push({
              sku_code: skuCode,
              status: 'fail',
              error: 'Invalid stock value'
            });
            willFailCount++;
            continue;
          }
          changes.stock = { old: '-', new: newStock };
          hasChanges = true;
        }

        // Check product_name - ONLY if selected
        if (selectedFields.product_name && row.product_name && row.product_name !== existingSKU.product_name) {
          changes.product_name = { old: existingSKU.product_name, new: row.product_name };
          hasChanges = true;
        }

        // Check image_url - ONLY if selected
        if (selectedFields.image_url && row.image_url && row.image_url !== existingSKU.image_url) {
          changes.image_url = { old: existingSKU.image_url || '-', new: row.image_url };
          hasChanges = true;
        }

        if (hasChanges) {
          preview.push({
            sku_code: skuCode,
            status: 'update',
            changes,
            existingSKU
          });
          willUpdateCount++;
        } else {
          preview.push({
            sku_code: skuCode,
            status: 'no_change'
          });
        }
      }

      setPreviewData({
        rows: preview,
        willUpdateCount,
        willFailCount,
        noChangeCount: preview.length - willUpdateCount - willFailCount
      });
      setStep('preview');

    } catch (error) {
      toast({
        title: 'Preview failed',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleApplyUpdates = async () => {
    setStep('processing');
    setProcessing(true);
    
    const updateRows = previewData.rows.filter(r => r.status === 'update');
    const total = updateRows.length;
    let successCount = 0;
    let failCount = 0;
    const errors = [];

    setProgress({ current: 0, total, successCount: 0, failCount: 0 });

    try {
      // Pre-fetch and cache all suppliers
      const allSuppliers = await base44.entities.Supplier.filter({ tenant_id: tenantId });
      const supplierCache = new Map();
      allSuppliers.forEach(sup => {
        supplierCache.set(sup.id, sup);
        supplierCache.set(sup.supplier_name.toLowerCase().trim(), sup);
      });

      // Fetch current stock
      const allStock = await base44.entities.CurrentStock.filter({ tenant_id: tenantId });
      const stockMap = new Map();
      allStock.forEach(stock => {
        stockMap.set(stock.sku_id, stock);
      });

      // Process sequentially with retry logic to avoid rate limits
      const BATCH_DELAY = 500;
      const BATCH_SIZE = 10;
      const MAX_RETRIES = 3;

      const updateWithRetry = async (row, retryCount = 0) => {
        try {
          const updateData = {};
          
          // Handle supplier - ONLY if it's in changes (meaning it was selected)
          if (row.changes.supplier) {
            const newSupplierName = row.changes.supplier.new.replace(' (new)', '').trim();
            
            // Handle empty supplier (set to null)
            if (!newSupplierName || newSupplierName === '-') {
              updateData.supplier_id = null;
            } else {
              try {
                const supplierId = await resolveOrCreateSupplier(tenantId, newSupplierName, supplierCache);
                updateData.supplier_id = supplierId;
              } catch (err) {
                throw new Error(`Failed to resolve supplier: ${err.message}`);
              }
            }
          }

          // Handle other fields - ONLY if they're in changes
          if (row.changes.cost) {
            updateData.cost_price = row.changes.cost.new;
          }
          if (row.changes.product_name) {
            updateData.product_name = row.changes.product_name.new;
          }
          if (row.changes.image_url) {
            updateData.image_url = row.changes.image_url.new;
          }

          // Only update if there are actual changes
          if (Object.keys(updateData).length > 0) {
            await base44.entities.SKU.update(row.existingSKU.id, updateData);
          }

          // Handle stock update if provided
          if (row.changes.stock) {
            const stockRecord = stockMap.get(row.existingSKU.id);
            if (stockRecord) {
              await base44.entities.CurrentStock.update(stockRecord.id, {
                quantity_available: row.changes.stock.new
              });
            } else {
              await base44.entities.CurrentStock.create({
                tenant_id: tenantId,
                sku_id: row.existingSKU.id,
                sku_code: row.existingSKU.sku_code,
                quantity_available: row.changes.stock.new
              });
            }
          }

          return { success: true };
        } catch (error) {
          if (retryCount < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            return updateWithRetry(row, retryCount + 1);
          }
          throw error;
        }
      };

      // Process in batches
      for (let i = 0; i < updateRows.length; i += BATCH_SIZE) {
        const batch = updateRows.slice(i, i + BATCH_SIZE);
        
        const batchPromises = batch.map(async (row) => {
          try {
            await updateWithRetry(row);
            successCount++;
          } catch (error) {
            failCount++;
            errors.push({
              sku_code: row.sku_code,
              error: error.message
            });
          }
          
          setProgress({
            current: i + batch.indexOf(row) + 1,
            total,
            successCount,
            failCount
          });
        });

        await Promise.all(batchPromises);
        
        // Delay before next batch
        if (i + BATCH_SIZE < updateRows.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
        }
      }

      setProcessing(false);
      setResult({
        status: failCount === 0 ? 'success' : 'partial',
        total: total,
        successCount,
        failCount,
        errors
      });
      setStep('complete');

    } catch (error) {
      setProcessing(false);
      setResult({
        status: 'failed',
        total: total,
        successCount,
        failCount,
        error: error.message
      });
      setStep('complete');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk Update SKUs</DialogTitle>
          <DialogDescription>
            Select which fields to update for your SKUs
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4">
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
                id="csvFile"
              />
              <label htmlFor="csvFile" className="cursor-pointer">
                <Upload className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                <p className="text-sm font-medium">Click to select CSV file</p>
                <p className="text-xs text-gray-500">or drag and drop</p>
              </label>
            </div>

            {file && <p className="text-sm text-green-600">✓ {file.name} selected</p>}

            <Button onClick={downloadTemplate} variant="outline" className="w-full">
              <Download className="w-4 h-4 mr-2" />
              Download Template
            </Button>

            <div className="bg-blue-50 p-3 rounded text-sm text-blue-900">
              CSV must have: <strong>sku_code</strong> column
              <br />
              Optional: <strong>supplier, cost, stock, product_name, image_url</strong>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleDetectColumns} disabled={!file} className="flex-1">
                <ArrowRight className="w-4 h-4 mr-2" />
                Next
              </Button>
              <Button onClick={() => onClose()} variant="outline" className="flex-1">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {step === 'fields' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Select which fields to update:</p>

            <div className="space-y-2">
              {detectedColumns.map(col => (
                <label key={col} className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedFields[col] || false}
                    onChange={(e) => setSelectedFields({...selectedFields, [col]: e.target.checked})}
                    className="w-4 h-4"
                  />
                  <span className="capitalize">{col.replace(/_/g, ' ')}</span>
                </label>
              ))}
            </div>

            <div className="flex gap-2">
              <Button onClick={handlePreview} className="flex-1">
                Preview Changes
              </Button>
              <Button onClick={() => setStep('upload')} variant="outline" className="flex-1">
                Back
              </Button>
            </div>
          </div>
        )}

        {step === 'preview' && previewData && (
          <div className="space-y-4 max-h-96 overflow-y-auto">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="p-2 bg-green-50 rounded text-green-800">
                Will update: <strong>{previewData.willUpdateCount}</strong>
              </div>
              <div className="p-2 bg-gray-50 rounded text-gray-800">
                No change: <strong>{previewData.noChangeCount}</strong>
              </div>
              <div className="p-2 bg-red-50 rounded text-red-800">
                Will fail: <strong>{previewData.willFailCount}</strong>
              </div>
            </div>

            <div className="space-y-2">
              {previewData.rows.slice(0, 10).map((row, i) => (
                <div key={i} className="text-sm border rounded p-2">
                  <div className="flex justify-between items-center">
                    <span className="font-medium">{row.sku_code}</span>
                    {row.status === 'update' && <CheckCircle className="w-4 h-4 text-green-600" />}
                    {row.status === 'fail' && <X className="w-4 h-4 text-red-600" />}
                    {row.status === 'no_change' && <span className="text-xs text-gray-500">No change</span>}
                  </div>
                  {row.status === 'update' && (
                    <div className="text-xs text-gray-600 mt-1">
                      {Object.entries(row.changes).map(([field, change]) => (
                        <div key={field}>{field}: {change.old} → {change.new}</div>
                      ))}
                    </div>
                  )}
                  {row.status === 'fail' && (
                    <div className="text-xs text-red-600 mt-1">{row.error}</div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button onClick={handleApplyUpdates} className="flex-1 bg-green-600 hover:bg-green-700">
                <CheckCircle className="w-4 h-4 mr-2" />
                Apply Updates
              </Button>
              <Button onClick={() => setStep('fields')} variant="outline" className="flex-1">
                Back
              </Button>
            </div>
          </div>
        )}

        {step === 'processing' && (
          <div className="space-y-4">
            <div className="text-sm text-gray-600">
              Processing {progress.current} of {progress.total}
            </div>
            <Progress value={(progress.current / progress.total) * 100} />
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="p-2 bg-green-50 rounded">Success: {progress.successCount}</div>
              <div className="p-2 bg-red-50 rounded">Failed: {progress.failCount}</div>
            </div>
          </div>
        )}

        {step === 'complete' && result && (
          <div className="space-y-4">
            {result.status === 'success' ? (
              <div className="p-4 bg-green-50 rounded-lg text-green-900">
                <CheckCircle className="w-6 h-6 mx-auto mb-2" />
                <p className="font-medium">All updates completed successfully!</p>
                <p className="text-sm mt-1">{result.successCount} SKUs updated</p>
              </div>
            ) : (
              <div className="p-4 bg-yellow-50 rounded-lg text-yellow-900">
                <AlertCircle className="w-6 h-6 mx-auto mb-2" />
                <p className="font-medium">Update completed with errors</p>
                <p className="text-sm mt-1">
                  Success: {result.successCount} | Failed: {result.failCount}
                </p>
                {result.errors && result.errors.length > 0 && (
                  <div className="mt-3 space-y-1 text-xs">
                    {result.errors.slice(0, 5).map((err, i) => (
                      <div key={i}>{err.sku_code}: {err.error}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <Button onClick={() => {
              onClose();
              if (onComplete) onComplete();
              setStep('upload');
              setFile(null);
            }} className="w-full">
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}