import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, Download, AlertCircle, CheckCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { useToast } from '@/components/ui/use-toast';

export default function BulkUploadModal({ open, onClose, tenantId, onSuccess }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const { toast } = useToast();

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.type === 'text/csv') {
      setFile(selectedFile);
      setResult(null);
    } else {
      toast({ title: 'Invalid file', description: 'Please select a CSV file', variant: 'destructive' });
    }
  };

  const parseCSV = (text) => {
    const lines = text.split('\n').filter(line => line.trim());
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      rows.push(row);
    }

    return rows;
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    const errors = [];
    let successCount = 0;
    let skusUpdated = new Set();
    let totalQuantity = 0;
    let totalCost = 0;

    try {
      const text = await file.text();
      const rows = parseCSV(text);

      // Fetch all SKUs and suppliers for validation
      const skus = await base44.entities.SKU.filter({ tenant_id: tenantId });
      const suppliers = await base44.entities.Supplier.filter({ tenant_id: tenantId });
      const currentStocks = await base44.entities.CurrentStock.filter({ tenant_id: tenantId });

      // Create batch record
      const batch = await base44.entities.ImportBatch.create({
        tenant_id: tenantId,
        batch_type: 'purchases',
        batch_name: `Purchase Batch - ${format(new Date(), 'MMM d, yyyy h:mm a')}`,
        filename: file.name,
        status: 'processing',
        total_rows: rows.length
      });

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = i + 2; // +2 because of header and 0-index

        try {
          // Validate required fields
          if (!row.sku_code) {
            errors.push({ ...row, row_number: rowNumber, error_reason: 'Missing sku_code' });
            continue;
          }

          if (!row.quantity || isNaN(parseFloat(row.quantity))) {
            errors.push({ ...row, row_number: rowNumber, error_reason: 'Invalid or missing quantity' });
            continue;
          }

          if (!row.unit_price || isNaN(parseFloat(row.unit_price))) {
            errors.push({ ...row, row_number: rowNumber, error_reason: 'Invalid or missing unit_price' });
            continue;
          }

          // Find SKU
          const sku = skus.find(s => s.sku_code === row.sku_code);
          if (!sku) {
            errors.push({ ...row, row_number: rowNumber, error_reason: 'SKU not found' });
            continue;
          }

          const quantity = parseFloat(row.quantity);
          const unitPrice = parseFloat(row.unit_price);
          const lineTotalCost = quantity * unitPrice;

          // Handle supplier
          let supplierId = null;
          let supplierName = row.supplier_name || 'Generic';
          
          if (row.supplier_name) {
            let supplier = suppliers.find(s => s.supplier_name.toLowerCase() === row.supplier_name.toLowerCase());
            if (!supplier) {
              supplier = await base44.entities.Supplier.create({
                tenant_id: tenantId,
                supplier_name: row.supplier_name
              });
              suppliers.push(supplier);
            }
            supplierId = supplier.id;
          }

          // Handle purchase date
          let purchaseDate = row.purchase_date || format(new Date(), 'yyyy-MM-dd');
          
          // Validate date format
          if (row.purchase_date) {
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(row.purchase_date)) {
              purchaseDate = format(new Date(), 'yyyy-MM-dd');
            }
          }

          // Create Purchase record
          const purchase = await base44.entities.Purchase.create({
            tenant_id: tenantId,
            sku_id: sku.id,
            sku_code: sku.sku_code,
            quantity_purchased: quantity,
            total_cost: lineTotalCost,
            cost_per_unit: unitPrice,
            purchase_date: purchaseDate,
            supplier_id: supplierId,
            supplier_name: supplierName,
            quantity_remaining: quantity,
            import_batch_id: batch.id
          });

          totalQuantity += quantity;
          totalCost += lineTotalCost;

          // Update CurrentStock
          let stock = currentStocks.find(s => s.sku_id === sku.id);
          if (stock) {
            await base44.entities.CurrentStock.update(stock.id, {
              quantity_available: stock.quantity_available + quantity
            });
            stock.quantity_available += quantity;
          } else {
            await base44.entities.CurrentStock.create({
              tenant_id: tenantId,
              sku_id: sku.id,
              sku_code: sku.sku_code,
              quantity_available: quantity
            });
          }

          // Create StockMovement record
          await base44.entities.StockMovement.create({
            tenant_id: tenantId,
            sku_id: sku.id,
            sku_code: sku.sku_code,
            movement_type: 'purchase',
            quantity: quantity,
            reference_type: 'purchase',
            reference_id: purchase.id,
            movement_date: purchaseDate,
            notes: `Bulk upload from CSV`
          });

          successCount++;
          skusUpdated.add(sku.sku_code);
        } catch (error) {
          errors.push({ 
            ...row, 
            row_number: rowNumber, 
            error_reason: error.message || 'Processing failed' 
          });
        }
      }

      // Update batch status
      const batchStatus = errors.length === 0 ? 'success' : 
                          successCount === 0 ? 'failed' : 'partial';
      
      await base44.entities.ImportBatch.update(batch.id, {
        status: batchStatus,
        success_rows: successCount,
        failed_rows: errors.length
      });

      setResult({
        total: rows.length,
        success: successCount,
        skusUpdated: skusUpdated.size,
        errors: errors.length,
        errorData: errors
      });

      if (successCount > 0) {
        onSuccess();
      }

      toast({
        title: 'Upload complete',
        description: `${successCount} purchases created, ${skusUpdated.size} SKUs updated, ${errors.length} errors`
      });

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

  const downloadErrorCSV = () => {
    if (!result || !result.errorData || result.errorData.length === 0) return;

    const headers = ['Row Number', 'SKU Code', 'Quantity', 'Unit Price', 'Supplier Name', 'Purchase Date', 'Error Reason'];
    const csvContent = [
      headers.join(','),
      ...result.errorData.map(row => [
        row.row_number,
        row.sku_code || '',
        row.quantity || '',
        row.unit_price || '',
        row.supplier_name || '',
        row.purchase_date || '',
        row.error_reason || ''
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `purchase_upload_errors_${format(new Date(), 'yyyy-MM-dd_HHmmss')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const downloadTemplate = () => {
    const template = 'sku_code,quantity,unit_price,supplier_name,purchase_date\nSKU001,100,15.50,Acme Corp,2026-01-18\nSKU002,50,22.00,Tech Supplies,2026-01-18';
    const blob = new Blob([template], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'purchase_upload_template.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleClose = () => {
    setFile(null);
    setResult(null);
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
                      {result.success} purchases created successfully
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