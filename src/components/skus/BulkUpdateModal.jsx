import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, Download, AlertCircle, CheckCircle, X, ArrowRight } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { base44 } from '@/api/base44Client';
import { Progress } from '@/components/ui/progress';

export default function BulkUpdateModal({ open, onClose, onComplete, tenantId }) {
  const { toast } = useToast();
  const [file, setFile] = useState(null);
  const [step, setStep] = useState('upload'); // 'upload', 'preview', 'processing', 'complete'
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
    if (lines.length < 2) return [];

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
    
    return rows;
  };

  const handlePreview = async () => {
    if (!file) return;

    try {
      const text = await file.text();
      const rows = parseCSV(text);

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

      const supplierMap = new Map();
      allSuppliers.forEach(sup => {
        supplierMap.set(sup.supplier_name.toLowerCase().trim(), sup);
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

        // Check supplier
        if (row.supplier) {
          const supplierName = row.supplier.trim();
          let supplier = supplierMap.get(supplierName.toLowerCase());
          
          if (!supplier) {
            // Will create new supplier
            changes.supplier = { old: existingSKU.supplier_id || '-', new: `${supplierName} (new)` };
            hasChanges = true;
          } else if (supplier.id !== existingSKU.supplier_id) {
            changes.supplier = { old: existingSKU.supplier_id || '-', new: supplier.supplier_name };
            hasChanges = true;
          }
        }

        // Check cost
        if (row.cost !== undefined) {
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

        // Check stock
        if (row.stock !== undefined) {
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

        // Check product_name
        if (row.product_name && row.product_name !== existingSKU.product_name) {
          changes.product_name = { old: existingSKU.product_name, new: row.product_name };
          hasChanges = true;
        }

        // Check image_url
        if (row.image_url && row.image_url !== existingSKU.image_url) {
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
      // Fetch fresh suppliers
      const allSuppliers = await base44.entities.Supplier.filter({ tenant_id: tenantId });
      const supplierMap = new Map();
      allSuppliers.forEach(sup => {
        supplierMap.set(sup.supplier_name.toLowerCase().trim(), sup);
      });

      // Fetch current stock
      const allStock = await base44.entities.CurrentStock.filter({ tenant_id: tenantId });
      const stockMap = new Map();
      allStock.forEach(stock => {
        stockMap.set(stock.sku_id, stock);
      });

      // Process in batches
      const BATCH_SIZE = 50;
      for (let i = 0; i < updateRows.length; i += BATCH_SIZE) {
        const batch = updateRows.slice(i, i + BATCH_SIZE);
        
        await Promise.all(batch.map(async (row) => {
          try {
            const updateData = {};
            
            // Handle supplier
            if (row.changes.supplier) {
              const newSupplierName = row.changes.supplier.new.replace(' (new)', '');
              let supplier = supplierMap.get(newSupplierName.toLowerCase());
              
              if (!supplier) {
                // Create new supplier
                supplier = await base44.entities.Supplier.create({
                  tenant_id: tenantId,
                  supplier_name: newSupplierName
                });
                supplierMap.set(newSupplierName.toLowerCase(), supplier);
              }
              
              updateData.supplier_id = supplier.id;
            }

            // Handle other fields
            if (row.changes.cost) {
              updateData.cost_price = row.changes.cost.new;
            }
            if (row.changes.product_name) {
              updateData.product_name = row.changes.product_name.new;
            }
            if (row.changes.image_url) {
              updateData.image_url = row.changes.image_url.new;
            }

            // Update SKU
            await base44.entities.SKU.update(row.existingSKU.id, updateData);

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
                  sku_code: row.sku_code,
                  quantity_available: row.changes.stock.new
                });
              }
            }

            successCount++;
          } catch (error) {
            failCount++;
            errors.push({
              sku_code: row.sku_code,
              error_message: error.message
            });
          }

          setProgress({ 
            current: successCount + failCount, 
            total, 
            successCount, 
            failCount 
          });
        }));
      }

      // Generate error CSV if needed
      let errorFileUrl = null;
      if (errors.length > 0) {
        const errorCSV = [
          'sku_code,error_message',
          ...errors.map(e => `"${e.sku_code}","${e.error_message}"`)
        ].join('\n');
        
        const blob = new Blob([errorCSV], { type: 'text/csv' });
        const errorFile = new File([blob], `update_errors_${Date.now()}.csv`, { type: 'text/csv' });
        const uploadResult = await base44.integrations.Core.UploadFile({ file: errorFile });
        errorFileUrl = uploadResult.file_url;
      }

      setResult({
        successCount,
        failCount,
        errorFileUrl
      });
      setStep('complete');

      if (onComplete) {
        onComplete();
      }

    } catch (error) {
      toast({
        title: 'Update failed',
        description: error.message,
        variant: 'destructive'
      });
      setStep('preview');
    } finally {
      setProcessing(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setStep('upload');
    setPreviewData(null);
    setResult(null);
    setProgress({ current: 0, total: 0, successCount: 0, failCount: 0 });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Update SKUs</DialogTitle>
          <DialogDescription>
            Update existing SKU records by uploading a CSV file
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-semibold text-blue-900 mb-2">How it works:</h4>
              <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
                <li>Download the CSV template or prepare your file</li>
                <li>Required column: <code className="bg-blue-100 px-1 rounded">sku_code</code></li>
                <li>Optional columns: supplier, cost, stock, product_name, image_url</li>
                <li>Only update fields you include (blank cells won't overwrite)</li>
                <li>Preview changes before applying</li>
              </ol>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={downloadTemplate}>
                <Download className="w-4 h-4 mr-2" />
                Download Template
              </Button>
            </div>

            <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center">
              <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
              <input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
                id="bulk-update-file"
              />
              <label htmlFor="bulk-update-file">
                <Button variant="outline" asChild>
                  <span>Select CSV File</span>
                </Button>
              </label>
              {file && (
                <p className="mt-3 text-sm text-slate-600">
                  Selected: <strong>{file.name}</strong>
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handlePreview} disabled={!file}>
                Preview Changes
              </Button>
            </div>
          </div>
        )}

        {step === 'preview' && previewData && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-green-700">{previewData.willUpdateCount}</div>
                <div className="text-sm text-green-600">Will Update</div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-red-700">{previewData.willFailCount}</div>
                <div className="text-sm text-red-600">Will Fail</div>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-slate-700">{previewData.noChangeCount}</div>
                <div className="text-sm text-slate-600">No Change</div>
              </div>
            </div>

            <div className="border border-slate-200 rounded-lg overflow-hidden max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left">SKU Code</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-left">Changes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {previewData.rows.map((row, idx) => (
                    <tr key={idx} className={
                      row.status === 'fail' ? 'bg-red-50' :
                      row.status === 'update' ? 'bg-green-50' :
                      'bg-slate-50'
                    }>
                      <td className="px-4 py-2 font-medium">{row.sku_code}</td>
                      <td className="px-4 py-2">
                        {row.status === 'fail' && (
                          <span className="inline-flex items-center gap-1 text-red-600">
                            <X className="w-4 h-4" /> {row.error}
                          </span>
                        )}
                        {row.status === 'update' && (
                          <span className="inline-flex items-center gap-1 text-green-600">
                            <CheckCircle className="w-4 h-4" /> Will Update
                          </span>
                        )}
                        {row.status === 'no_change' && (
                          <span className="text-slate-500">No changes</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {row.changes && (
                          <div className="space-y-1 text-xs">
                            {Object.entries(row.changes).map(([field, change]) => (
                              <div key={field} className="flex items-center gap-2">
                                <span className="font-medium capitalize">{field.replace('_', ' ')}:</span>
                                <span className="text-slate-500">{String(change.old)}</span>
                                <ArrowRight className="w-3 h-3" />
                                <span className="text-green-600 font-medium">{String(change.new)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setStep('upload')}>Back</Button>
              <Button 
                onClick={handleApplyUpdates} 
                disabled={previewData.willUpdateCount === 0}
                className="bg-green-600 hover:bg-green-700"
              >
                Apply {previewData.willUpdateCount} Update(s)
              </Button>
            </div>
          </div>
        )}

        {step === 'processing' && (
          <div className="space-y-6 py-8">
            <div className="text-center">
              <div className="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Processing Updates...</h3>
              <p className="text-slate-600">
                {progress.current} of {progress.total} processed
              </p>
            </div>

            <Progress value={(progress.current / progress.total) * 100} className="h-2" />

            <div className="grid grid-cols-2 gap-4 text-center">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="text-2xl font-bold text-green-700">{progress.successCount}</div>
                <div className="text-sm text-green-600">Successful</div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="text-2xl font-bold text-red-700">{progress.failCount}</div>
                <div className="text-sm text-red-600">Failed</div>
              </div>
            </div>
          </div>
        )}

        {step === 'complete' && result && (
          <div className="space-y-6 py-4">
            <div className="text-center">
              <CheckCircle className="w-16 h-16 text-green-600 mx-auto mb-4" />
              <h3 className="text-xl font-bold mb-2">Update Complete!</h3>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
                <div className="text-3xl font-bold text-green-700">{result.successCount}</div>
                <div className="text-sm text-green-600 mt-1">Successfully Updated</div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
                <div className="text-3xl font-bold text-red-700">{result.failCount}</div>
                <div className="text-sm text-red-600 mt-1">Failed</div>
              </div>
            </div>

            {result.errorFileUrl && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-amber-800 mb-2">
                    Some updates failed. Download the error report for details.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(result.errorFileUrl, '_blank')}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Error Report
                  </Button>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={handleClose}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}