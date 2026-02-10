import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Upload, Download, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import TaskProgressModal from '@/components/shared/TaskProgressModal';

export default function BulkUploadModal({ open, onClose, onComplete }) {
  const { tenantId } = useTenant();
  const [file, setFile] = useState(null);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [parsedData, setParsedData] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progressState, setProgressState] = useState({
    current: 0,
    total: 0,
    successCount: 0,
    failCount: 0,
    completed: false,
    log: []
  });
  const [result, setResult] = useState(null);
  const [failedRows, setFailedRows] = useState([]);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.type === 'text/csv') {
      setFile(selectedFile);
      setResult(null);
      setFailedRows([]);
    }
  };

  // Normalize header for mapping
  const normalizeHeader = (header) => {
    return header.toLowerCase().replace(/[\s_]/g, '');
  };

  // Map CSV headers to internal fields
  const mapHeaders = (headers) => {
    const mapping = {
      'skucode': 'sku_code',
      'productname': 'product_name',
      'cost': 'cost',
      'supplier': 'supplier',
      'stock': 'stock',
      'initialstock': 'stock',
      'imageurl': 'image_url'
    };

    const mapped = {};
    headers.forEach(header => {
      const normalized = normalizeHeader(header);
      if (mapping[normalized]) {
        mapped[header] = mapping[normalized];
      }
    });

    return mapped;
  };

  // Validate row data
  const validateRow = (row, rowIndex) => {
    const errors = [];

    // Required: sku_code
    if (!row.sku_code || row.sku_code.trim() === '') {
      errors.push('sku_code is required');
    }

    // Required: product_name
    if (!row.product_name || row.product_name.trim() === '') {
      errors.push('product_name is required');
    }

    // Required: cost (must be number > 0)
    const cost = parseFloat(row.cost);
    if (isNaN(cost) || cost <= 0) {
      errors.push('cost must be a number greater than 0');
    }

    // Optional: stock (must be integer >= 0)
    if (row.stock !== undefined && row.stock !== null && row.stock !== '') {
      const stock = parseInt(row.stock);
      if (isNaN(stock) || stock < 0) {
        errors.push('stock must be an integer >= 0');
      }
    }

    // Optional: image_url (basic URL validation)
    if (row.image_url && row.image_url.trim() !== '') {
      try {
        new URL(row.image_url);
      } catch {
        errors.push('image_url must be a valid URL');
      }
    }

    return errors;
  };

  // Parse CSV file with support for multiline quoted fields
  const parseCSV = async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const text = e.target.result;
          
          // Parse CSV properly handling quoted multiline fields
          const parseCSVLine = (text) => {
            const rows = [];
            let currentRow = [];
            let currentField = '';
            let insideQuotes = false;
            
            for (let i = 0; i < text.length; i++) {
              const char = text[i];
              const nextChar = text[i + 1];
              
              if (char === '"') {
                if (insideQuotes && nextChar === '"') {
                  // Escaped quote
                  currentField += '"';
                  i++; // Skip next quote
                } else {
                  // Toggle quote state
                  insideQuotes = !insideQuotes;
                }
              } else if (char === ',' && !insideQuotes) {
                // End of field
                currentRow.push(currentField.trim());
                currentField = '';
              } else if ((char === '\n' || char === '\r') && !insideQuotes) {
                // End of row
                if (char === '\r' && nextChar === '\n') {
                  i++; // Skip \n after \r
                }
                if (currentField || currentRow.length > 0) {
                  currentRow.push(currentField.trim());
                  if (currentRow.some(f => f.length > 0)) {
                    rows.push(currentRow);
                  }
                  currentRow = [];
                  currentField = '';
                }
              } else {
                currentField += char;
              }
            }
            
            // Add last field and row
            if (currentField || currentRow.length > 0) {
              currentRow.push(currentField.trim());
              if (currentRow.some(f => f.length > 0)) {
                rows.push(currentRow);
              }
            }
            
            return rows;
          };
          
          const allRows = parseCSVLine(text);
          
          if (allRows.length < 2) {
            reject(new Error('CSV file must contain headers and at least one data row'));
            return;
          }

          // Parse headers
          const rawHeaders = allRows[0];
          
          // Map headers
          const headerMapping = mapHeaders(rawHeaders);
          const requiredFields = ['sku_code', 'product_name', 'cost'];
          const mappedFields = Object.values(headerMapping);
          
          const missingFields = requiredFields.filter(field => !mappedFields.includes(field));
          if (missingFields.length > 0) {
            reject(new Error(
              `Missing required columns: ${missingFields.join(', ')}\n\n` +
              `Detected headers: ${rawHeaders.join(', ')}\n\n` +
              `Please ensure your CSV has columns: sku_code, product_name, cost`
            ));
            return;
          }

          // Parse data rows and sanitize
          const rows = [];
          for (let i = 1; i < allRows.length; i++) {
            const values = allRows[i];
            
            // Map values to internal fields
            const row = { _rowIndex: i };
            rawHeaders.forEach((header, index) => {
              const internalField = headerMapping[header];
              if (internalField && values[index] !== undefined) {
                let value = values[index];
                
                // Sanitize text fields: replace newlines with spaces
                if (internalField === 'product_name' || internalField === 'supplier') {
                  value = value.replace(/[\r\n]+/g, ' ').trim();
                }
                
                row[internalField] = value;
              }
            });

            // Set defaults
            if (!row.stock || row.stock === '') {
              row.stock = 0;
            }

            rows.push(row);
          }

          resolve({ headers: rawHeaders, rows });
        } catch (error) {
          reject(new Error(`Failed to parse CSV: ${error.message}`));
        }
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file, 'utf-8');
    });
  };

  const handleValidateAndParse = async () => {
    if (!file) return;

    // Show initial parsing stage
    setProgressState({
      current: 0,
      total: 0,
      successCount: 0,
      failCount: 0,
      completed: false,
      log: ['Reading CSV file...']
    });
    setUploading(true);

    try {
      // Stage 1: Parse CSV
      const parsed = await parseCSV(file);
      
      setProgressState(prev => ({
        ...prev,
        log: ['✓ File read successfully', `Found ${parsed.rows.length} rows`, 'Validating data...']
      }));

      // Stage 2: Validate all rows
      const validRows = [];
      const invalidRows = [];

      parsed.rows.forEach((row) => {
        const errors = validateRow(row, row._rowIndex);
        if (errors.length > 0) {
          invalidRows.push({
            ...row,
            error_reason: errors.join('; ')
          });
        } else {
          validRows.push(row);
        }
      });

      setUploading(false);

      if (validRows.length === 0) {
        setResult({
          status: 'failed',
          total_rows: parsed.rows.length,
          success_rows: 0,
          failed_rows: invalidRows.length,
          error: 'No valid rows found in CSV'
        });
        setFailedRows(invalidRows);
        setProgressState({
          current: 0,
          total: 0,
          successCount: 0,
          failCount: 0,
          completed: false,
          log: []
        });
        return;
      }

      // Store parsed data and show conflict resolution dialog
      setParsedData({ validRows, invalidRows });
      setShowConflictDialog(true);
      setProgressState({
        current: 0,
        total: 0,
        successCount: 0,
        failCount: 0,
        completed: false,
        log: []
      });
    } catch (error) {
      console.error('CSV parsing failed:', error);
      setUploading(false);
      setResult({
        status: 'failed',
        total_rows: 0,
        success_rows: 0,
        failed_rows: 0,
        error: `Upload failed to start: ${error.message}`
      });
      setProgressState({
        current: 0,
        total: 0,
        successCount: 0,
        failCount: 0,
        completed: false,
        log: []
      });
    }
  };

  const handleStartUpload = async (upsertMode) => {
    setShowConflictDialog(false);
    setUploading(true);
    
    const { validRows, invalidRows } = parsedData;
    const totalRows = validRows.length;
    const BATCH_SIZE = 100; // Increased from 20 to 100
    const CONCURRENCY = 4; // Process 4 batches concurrently
    const totalBatches = Math.ceil(totalRows / BATCH_SIZE);
    const failed = [...invalidRows];
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let processed = 0;

    // Initialize progress with total set immediately
    setProgressState({
      current: 0,
      total: totalRows,
      successCount: 0,
      failCount: invalidRows.length,
      completed: false,
      log: invalidRows.length > 0 
        ? [`${invalidRows.length} rows failed validation`, `Starting upload: ${totalRows} valid rows in ${totalBatches} batches (${BATCH_SIZE} rows/batch, ${CONCURRENCY} concurrent)...`] 
        : [`Starting upload: ${totalRows} rows in ${totalBatches} batches (${BATCH_SIZE} rows/batch, ${CONCURRENCY} concurrent)...`]
    });

    try {
      // Helper function to process a single batch
      const processBatch = async (batch, batchIndex) => {
        const batchNum = batchIndex + 1;
        const skuCodes = batch.map(row => row.sku_code);
        const batchResults = {
          created: 0,
          updated: 0,
          skipped: 0,
          failed: [],
          processed: 0
        };

        try {
          // Prefetch existing SKUs in one query
          const existingSKUs = await base44.entities.SKU.filter({
            tenant_id: tenantId,
            sku_code: { $in: skuCodes }
          });

          const existingMap = {};
          existingSKUs.forEach(sku => {
            existingMap[sku.sku_code] = sku;
          });

          // Split batch into operations
          const toCreate = [];
          const toUpdate = [];
          const toSkip = [];

          batch.forEach(row => {
            const existing = existingMap[row.sku_code];
            const skuData = {
              tenant_id: tenantId,
              sku_code: row.sku_code,
              product_name: row.product_name,
              cost_price: parseFloat(row.cost),
              supplier_id: row.supplier || null,
              image_url: row.image_url || null,
              _stock: parseInt(row.stock) || 0
            };

            if (existing) {
              if (upsertMode === 'update') {
                toUpdate.push({ ...skuData, _id: existing.id, _existing: existing });
              } else {
                toSkip.push(row);
              }
            } else {
              toCreate.push(skuData);
            }
          });

          // Bulk create new SKUs
          if (toCreate.length > 0) {
            try {
              const createdSKUs = await base44.entities.SKU.bulkCreate(
                toCreate.map(({ _stock, ...data }) => data)
              );
              
              // Create stock records for new SKUs with stock > 0
              const stockToCreate = [];
              createdSKUs.forEach((sku, idx) => {
                const stockQty = toCreate[idx]._stock;
                if (stockQty > 0) {
                  stockToCreate.push({
                    tenant_id: tenantId,
                    sku_id: sku.id,
                    sku_code: sku.sku_code,
                    quantity_available: stockQty
                  });
                }
              });

              if (stockToCreate.length > 0) {
                await base44.entities.CurrentStock.bulkCreate(stockToCreate);
              }

              batchResults.created = createdSKUs.length;
            } catch (error) {
              console.error('Bulk create failed, falling back to individual creates:', error);
              // Fallback to individual creates
              for (const skuData of toCreate) {
                try {
                  const newSKU = await base44.entities.SKU.create({
                    tenant_id: skuData.tenant_id,
                    sku_code: skuData.sku_code,
                    product_name: skuData.product_name,
                    cost_price: skuData.cost_price,
                    supplier_id: skuData.supplier_id,
                    image_url: skuData.image_url
                  });
                  
                  if (skuData._stock > 0) {
                    await base44.entities.CurrentStock.create({
                      tenant_id: tenantId,
                      sku_id: newSKU.id,
                      sku_code: skuData.sku_code,
                      quantity_available: skuData._stock
                    });
                  }
                  batchResults.created++;
                } catch (err) {
                  batchResults.failed.push({
                    sku_code: skuData.sku_code,
                    product_name: skuData.product_name,
                    cost: skuData.cost_price,
                    error_reason: err.message
                  });
                }
              }
            }
          }

          // Bulk update existing SKUs with Smart Patch (only update non-empty fields)
          if (toUpdate.length > 0) {
            const updatePromises = toUpdate.map(async (skuData) => {
              try {
                // Smart Patch: only update fields that are non-empty in CSV
                const updatePayload = { tenant_id: skuData.tenant_id };
                
                // Always update sku_code
                updatePayload.sku_code = skuData.sku_code;
                
                // Only update other fields if they're non-empty in the CSV
                if (skuData.product_name && skuData.product_name.trim()) {
                  updatePayload.product_name = skuData.product_name;
                }
                if (skuData.cost_price > 0) {
                  updatePayload.cost_price = skuData.cost_price;
                }
                if (skuData.supplier_id) {
                  updatePayload.supplier_id = skuData.supplier_id;
                }
                if (skuData.image_url && skuData.image_url.trim()) {
                  updatePayload.image_url = skuData.image_url;
                }
                
                await base44.entities.SKU.update(skuData._id, updatePayload);

                // Update stock
                const stockQty = skuData._stock;
                const stockRecords = await base44.entities.CurrentStock.filter({
                  tenant_id: tenantId,
                  sku_id: skuData._id
                });

                if (stockRecords.length > 0) {
                  await base44.entities.CurrentStock.update(stockRecords[0].id, {
                    quantity_available: stockQty
                  });
                } else if (stockQty > 0) {
                  await base44.entities.CurrentStock.create({
                    tenant_id: tenantId,
                    sku_id: skuData._id,
                    sku_code: skuData.sku_code,
                    quantity_available: stockQty
                  });
                }

                return { success: true };
              } catch (error) {
                return { 
                  success: false, 
                  sku_code: skuData.sku_code,
                  product_name: skuData.product_name,
                  cost: skuData.cost_price,
                  error_reason: error.message 
                };
              }
            });

            const updateResults = await Promise.all(updatePromises);
            updateResults.forEach(result => {
              if (result.success) {
                batchResults.updated++;
              } else {
                batchResults.failed.push(result);
              }
            });
          }

          // Count skipped
          batchResults.skipped = toSkip.length;
          batchResults.processed = batch.length;

        } catch (error) {
          console.error(`Batch ${batchNum} failed:`, error);
          // Mark entire batch as failed
          batch.forEach(row => {
            batchResults.failed.push({
              ...row,
              error_reason: `Batch processing error: ${error.message}`
            });
          });
          batchResults.processed = batch.length;
        }

        return batchResults;
      };

      // Split into batch groups for concurrency control
      const batches = [];
      for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
        batches.push(validRows.slice(i, Math.min(i + BATCH_SIZE, validRows.length)));
      }

      // Process batches with concurrency limit
      for (let i = 0; i < batches.length; i += CONCURRENCY) {
        const batchGroup = batches.slice(i, Math.min(i + CONCURRENCY, batches.length));
        const batchIndexes = Array.from({ length: batchGroup.length }, (_, idx) => i + idx);

        // Update UI: processing batch group
        setProgressState(prev => ({
          ...prev,
          log: [`Processing batches ${i + 1}-${Math.min(i + CONCURRENCY, batches.length)} of ${totalBatches}...`, ...prev.log.slice(0, 49)]
        }));

        // Process batch group in parallel
        const results = await Promise.all(
          batchGroup.map((batch, idx) => processBatch(batch, batchIndexes[idx]))
        );

        // Aggregate results
        results.forEach(result => {
          created += result.created;
          updated += result.updated;
          skipped += result.skipped;
          processed += result.processed;
          failed.push(...result.failed);
        });

        // Update progress once per batch group
        setProgressState(prev => ({
          ...prev,
          current: processed,
          successCount: created + updated + skipped,
          failCount: failed.length,
          log: [
            `✓ Batches ${i + 1}-${Math.min(i + CONCURRENCY, batches.length)} complete: +${results.reduce((sum, r) => sum + r.created, 0)} created, +${results.reduce((sum, r) => sum + r.updated, 0)} updated`,
            ...prev.log.slice(0, 49)
          ]
        }));
      }

      // Mark complete
      setProgressState(prev => ({
        ...prev,
        completed: true
      }));

      const successCount = created + updated + skipped;
      setResult({
        status: failed.length === 0 ? 'success' : successCount > 0 ? 'partial' : 'failed',
        total_rows: totalRows + invalidRows.length,
        success_rows: successCount,
        failed_rows: failed.length,
        created,
        updated,
        skipped
      });
      setFailedRows(failed);
      
      if (onComplete) {
        onComplete();
      }
    } catch (error) {
      console.error('Upload process failed:', error);
      setProgressState(prev => ({
        ...prev,
        completed: true,
        log: [`❌ Upload failed: ${error.message}`, ...prev.log]
      }));
      setResult({
        status: 'failed',
        total_rows: totalRows,
        success_rows: 0,
        failed_rows: totalRows,
        error: `Upload failed: ${error.message}`
      });
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    if (uploading) return;
    setFile(null);
    setResult(null);
    setFailedRows([]);
    setParsedData(null);
    setProgressState({
      current: 0,
      total: 0,
      successCount: 0,
      failCount: 0,
      completed: false,
      log: []
    });
    onClose();
  };

  const downloadErrorCSV = () => {
    if (failedRows.length === 0) return;
    
    // Generate CSV client-side
    const headers = ['sku_code', 'product_name', 'cost', 'supplier', 'stock', 'image_url', 'error_reason'];
    const csvContent = [
      headers.join(','),
      ...failedRows.map(row => {
        return headers.map(header => {
          const value = row[header] || '';
          // Escape quotes and wrap in quotes if contains comma
          const escaped = String(value).replace(/"/g, '""');
          return escaped.includes(',') ? `"${escaped}"` : escaped;
        }).join(',');
      })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sku_upload_errors_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      <Dialog open={open && !uploading} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Bulk Upload SKUs</DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Upload Requirements */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-blue-900 mb-2">Required Columns:</h4>
              <div className="text-sm text-blue-700 space-y-1">
                <div>• <strong>sku_code</strong> (required, unique)</div>
                <div>• <strong>product_name</strong> (required)</div>
                <div>• <strong>cost</strong> (required, number &gt; 0)</div>
                <div>• <strong>supplier</strong> (optional, name)</div>
                <div>• <strong>stock</strong> (optional, integer ≥ 0, default 0)</div>
                <div>• <strong>image_url</strong> (optional, URL)</div>
              </div>
              <p className="text-xs text-blue-600 mt-2">
                💡 Supports flexible headers (e.g., "SKU Code", "Product Name", etc.)
              </p>
            </div>

            {/* File Upload Area */}
            {!result && (
              <div>
                <label
                  htmlFor="csv-upload"
                  className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-indigo-500 hover:bg-slate-50 transition-all"
                >
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <Upload className="w-10 h-10 text-slate-400 mb-3" />
                    {file ? (
                      <div className="text-center">
                        <p className="text-sm font-medium text-slate-700">{file.name}</p>
                        <p className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB</p>
                      </div>
                    ) : (
                      <div className="text-center">
                        <p className="text-sm font-medium text-slate-700">Click to upload CSV</p>
                        <p className="text-xs text-slate-500">Supports UTF-8 (Arabic text)</p>
                      </div>
                    )}
                  </div>
                  <input
                    id="csv-upload"
                    type="file"
                    accept=".csv"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>

                {file && (
                  <div className="flex gap-3 mt-4">
                    <Button
                      onClick={handleValidateAndParse}
                      className="flex-1"
                    >
                      Validate & Upload
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setFile(null)}
                    >
                      Clear
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Results */}
            {result && (
              <div className="space-y-4">
                {result.status === 'success' && result.success_rows > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      <h4 className="font-semibold text-green-900">Upload Successful!</h4>
                    </div>
                    <div className="text-sm text-green-700 space-y-1">
                      <p>✓ Total rows: <strong>{result.total_rows}</strong></p>
                      {result.created > 0 && <p>✓ Created: <strong>{result.created}</strong></p>}
                      {result.updated > 0 && <p>✓ Updated: <strong>{result.updated}</strong></p>}
                      {result.skipped > 0 && <p>✓ Skipped: <strong>{result.skipped}</strong></p>}
                    </div>
                  </div>
                )}

                {result.status === 'partial' && (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <AlertCircle className="w-5 h-5 text-orange-600" />
                      <h4 className="font-semibold text-orange-900">Partial Success</h4>
                    </div>
                    <div className="text-sm text-orange-700 space-y-1">
                      <p>• Total rows: <strong>{result.total_rows}</strong></p>
                      <p>• Successful: <strong>{result.success_rows}</strong></p>
                      {result.created > 0 && <p>&nbsp;&nbsp;- Created: <strong>{result.created}</strong></p>}
                      {result.updated > 0 && <p>&nbsp;&nbsp;- Updated: <strong>{result.updated}</strong></p>}
                      {result.skipped > 0 && <p>&nbsp;&nbsp;- Skipped: <strong>{result.skipped}</strong></p>}
                      <p>• Failed: <strong>{result.failed_rows}</strong></p>
                    </div>
                    {failedRows.length > 0 && (
                      <Button
                        onClick={downloadErrorCSV}
                        variant="outline"
                        size="sm"
                        className="mt-3 border-orange-300 text-orange-700 hover:bg-orange-100"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download Failed Rows CSV
                      </Button>
                    )}
                  </div>
                )}

                {(result.status === 'failed' || result.success_rows === 0) && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <XCircle className="w-5 h-5 text-red-600" />
                      <h4 className="font-semibold text-red-900">Upload Failed</h4>
                    </div>
                    <div className="text-sm text-red-700 space-y-1">
                      {result.error && <p className="mb-2 font-medium">{result.error}</p>}
                      {result.total_rows > 0 && (
                        <>
                          <p>• Total rows: <strong>{result.total_rows}</strong></p>
                          <p>• Failed: <strong>{result.failed_rows}</strong></p>
                        </>
                      )}
                    </div>
                    {failedRows.length > 0 && (
                      <Button
                        onClick={downloadErrorCSV}
                        variant="outline"
                        size="sm"
                        className="mt-3 border-red-300 text-red-700 hover:bg-red-100"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download Failed Rows CSV
                      </Button>
                    )}
                  </div>
                )}

                <div className="flex gap-3">
                  <Button onClick={handleClose} className="flex-1">
                    Done
                  </Button>
                  <Button variant="outline" onClick={() => {
                    setResult(null);
                    setFailedRows([]);
                  }}>
                    Upload Another
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Conflict Resolution Dialog */}
      <AlertDialog open={showConflictDialog} onOpenChange={setShowConflictDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Handle Existing SKUs</AlertDialogTitle>
            <AlertDialogDescription>
              Some SKU codes in your file may already exist in the database. How would you like to handle them?
              <div className="mt-4 space-y-3">
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                  <p className="text-sm font-semibold text-indigo-900">Update Existing</p>
                  <p className="text-xs text-indigo-700">Overwrite existing SKU data with new values from the CSV</p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <p className="text-sm font-semibold text-slate-900">Skip Existing</p>
                  <p className="text-xs text-slate-700">Keep existing SKUs unchanged, only import new ones</p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleStartUpload('skip')} className="bg-slate-600">
              Skip Existing
            </AlertDialogAction>
            <AlertDialogAction onClick={() => handleStartUpload('update')}>
              Update Existing
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Progress Modal */}
      <TaskProgressModal
        open={uploading}
        onClose={() => {}}
        title="Uploading SKUs"
        current={progressState.current}
        total={progressState.total}
        successCount={progressState.successCount}
        failCount={progressState.failCount}
        completed={progressState.completed}
        log={progressState.log}
        allowMinimize={false}
      />
    </>
  );
}