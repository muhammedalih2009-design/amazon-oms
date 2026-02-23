import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, Loader, AlertCircle, Send, Download } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

export default function TelegramExportModal({ 
  open, 
  onClose, 
  tenantId, 
  items, 
  dateRange 
}) {
  const { toast } = useToast();
  const [step, setStep] = useState('confirm'); // confirm, suppliers, processing, completed
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState(null);
  const [polling, setPolling] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [suppliers, setSuppliers] = useState([]);
  const [selectedSuppliers, setSelectedSuppliers] = useState(new Set());
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);

  const supplierCount = [...new Set(items.map(i => i.supplier || 'Unassigned'))].length;

  useEffect(() => {
    if (step === 'processing' && jobId) {
      startPolling();
    }
    return () => {
      setPolling(false);
    };
  }, [step, jobId]);

  const startPolling = () => {
    setPolling(true);
    const interval = setInterval(async () => {
      try {
        const response = await base44.functions.invoke('getTelegramExportStatus', { jobId });
        setStatus(response.data);

        // Check if job is complete
        if (response.data.status === 'completed' || response.data.status === 'failed') {
          setStep('completed');
          setPolling(false);
          clearInterval(interval);
        }
      } catch (error) {
        console.error('[Telegram Modal] Polling error:', error);
        // Don't stop polling on error - keep trying
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(interval);
  };

  const loadSuppliers = async () => {
    setLoadingSuppliers(true);
    try {
      // Group items by supplier
      const supplierMap = {};
      items.forEach(item => {
        const supplier = item.supplier || 'Unassigned';
        if (!supplierMap[supplier]) {
          supplierMap[supplier] = { skus: new Set(), qty: 0 };
        }
        supplierMap[supplier].skus.add(item.sku_code);
        supplierMap[supplier].qty += (item.to_buy || 0);
      });

      const suppliersList = Object.entries(supplierMap).map(([name, data]) => ({
        name,
        skus: data.skus.size,
        qty: data.qty
      }));

      setSuppliers(suppliersList);
      // Select all by default
      setSelectedSuppliers(new Set(suppliersList.map(s => s.name)));
    } finally {
      setLoadingSuppliers(false);
    }
  };

  const handleProceedToSuppliers = async () => {
    await loadSuppliers();
    setStep('suppliers');
  };

  const toggleSupplier = (supplierName) => {
    const newSelected = new Set(selectedSuppliers);
    if (newSelected.has(supplierName)) {
      newSelected.delete(supplierName);
    } else {
      newSelected.add(supplierName);
    }
    setSelectedSuppliers(newSelected);
  };

  const handleStart = async () => {
    if (selectedSuppliers.size === 0) {
      toast({
        title: 'No suppliers selected',
        description: 'Please select at least one supplier to export',
        variant: 'destructive'
      });
      return;
    }

    try {
      // Filter items by selected suppliers AND items that have quantity > 0
      const filteredItems = items.filter(item => {
        const hasValidSupplier = selectedSuppliers.has(item.supplier || 'Unassigned');
        const hasValidQuantity = Number(item.to_buy || 0) > 0;
        return hasValidSupplier && hasValidQuantity;
      });

      // Create background job and get job ID
      const response = await base44.functions.invoke('startTelegramExport', {
        tenantId,
        rows: filteredItems.map(item => ({
          imageUrl: item.image_url || '',
          supplier: item.supplier || 'Unassigned',
          sku: item.sku_code || '',
          product: item.product_name || '',
          toBuy: Number(item.to_buy || 0),
          unitCost: Number(item.cost_price || 0)
        })),
        dateRange
      });

      if (!response.data.jobId) {
        throw new Error('No job ID returned from server');
      }

      setJobId(response.data.jobId);
      setStep('processing');
      
      toast({
        title: 'Export Started',
        description: `Job ${response.data.jobId.slice(0, 8)}... created. Sending ${response.data.totalItems} items to Telegram...`
      });
    } catch (error) {
      console.error('[Telegram Modal] Start error:', error);
      toast({
        title: 'Failed to Start Export',
        description: error.message || 'Unknown error occurred',
        variant: 'destructive'
      });
    }
  };

  const handleResume = async () => {
    setResuming(true);
    try {
      await base44.functions.invoke('resumeTelegramExport', {
        jobId,
        tenantId
      });
      
      // Reset to processing step and restart polling
      setStep('processing');
      setStatus(null);
      
      toast({
        title: 'Export Resumed',
        description: 'Continuing from where it stopped...'
      });
    } catch (error) {
      console.error('[Resume] Error:', error);
      toast({
        title: 'Failed to Resume',
        description: error.message || 'Unknown error occurred',
        variant: 'destructive'
      });
    } finally {
      setResuming(false);
    }
  };

  const handleRetryFailed = async () => {
    try {
      const response = await base44.functions.invoke('retryFailedTelegramItems', { jobId });
      
      toast({
        title: 'Failed Items Reset',
        description: `${response.data.count} failed items marked as pending. Click Resume to retry.`
      });

      // Refresh status
      const statusResponse = await base44.functions.invoke('getTelegramExportStatus', { jobId });
      setStatus(statusResponse.data);
      
    } catch (error) {
      console.error('[Retry Failed] Error:', error);
      toast({
        title: 'Failed to Retry',
        description: error.message || 'Unknown error occurred',
        variant: 'destructive'
      });
    }
  };

  const downloadFailedItems = () => {
    if (!status?.failedItemsLog || status.failedItemsLog.length === 0) return;

    const csvHeader = 'SKU,Product,Supplier,Image URL,Strategy,Attempt A Error,Attempt B Error,Final Reason\n';
    const csvRows = status.failedItemsLog.map(item => {
      const sku = (item.sku || '').replace(/"/g, '""');
      const product = (item.product || '').replace(/"/g, '""');
      const supplier = (item.supplier || '').replace(/"/g, '""');
      const imageUrl = (item.imageUrl || 'N/A').replace(/"/g, '""');
      const strategy = (item.strategy || 'N/A').replace(/"/g, '""');
      const attemptA = (item.attemptAError || item.attemptA || 'N/A').replace(/"/g, '""');
      const attemptB = (item.attemptBError || item.attemptB || 'N/A').replace(/"/g, '""');
      const reason = (item.finalReason || item.reason || item.finalError || item.completeFailure || 'Unknown').replace(/"/g, '""');
      return `"${sku}","${product}","${supplier}","${imageUrl}","${strategy}","${attemptA}","${attemptB}","${reason}"`;
    }).join('\n');

    const csvContent = '\uFEFF' + csvHeader + csvRows;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `telegram_export_failed_items_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const progressPercent = status ? Math.round((status.sentItems / status.totalItems) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        {step === 'confirm' && (
          <>
            <DialogHeader>
              <DialogTitle>Send to Telegram</DialogTitle>
              <DialogDescription>
                This will send purchase requests to your configured Telegram group
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <div className="bg-indigo-50 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Suppliers:</span>
                  <span className="font-semibold text-slate-900">{supplierCount}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Items:</span>
                  <span className="font-semibold text-slate-900">{items.length}</span>
                </div>
              </div>

              <div className="text-xs text-slate-500 space-y-1">
                <p>• Each item will be sent as a photo with caption</p>
                <p>• Messages sent sequentially with rate limiting</p>
                <p>• This may take a few minutes for large exports</p>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleProceedToSuppliers} disabled={loadingSuppliers} className="bg-indigo-600 hover:bg-indigo-700">
                {loadingSuppliers ? (
                  <>
                    <Loader className="w-4 h-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : (
                  'Next Step'
                )}
              </Button>
            </div>
            </>
            )}

            {step === 'suppliers' && (
            <>
            <DialogHeader>
              <DialogTitle>Select Suppliers to Export</DialogTitle>
              <DialogDescription>
                Choose which suppliers to send to Telegram
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="border rounded-lg overflow-hidden max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">
                        <input
                          type="checkbox"
                          checked={selectedSuppliers.size === suppliers.length && suppliers.length > 0}
                          onChange={() => {
                            if (selectedSuppliers.size === suppliers.length) {
                              setSelectedSuppliers(new Set());
                            } else {
                              setSelectedSuppliers(new Set(suppliers.map(s => s.name)));
                            }
                          }}
                        />
                      </th>
                      <th className="px-4 py-2 text-left font-semibold">Supplier</th>
                      <th className="px-4 py-2 text-right font-semibold">SKUs</th>
                      <th className="px-4 py-2 text-right font-semibold">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map((supplier) => (
                      <tr key={supplier.name} className="border-t hover:bg-slate-50">
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={selectedSuppliers.has(supplier.name)}
                            onChange={() => toggleSupplier(supplier.name)}
                          />
                        </td>
                        <td className="px-4 py-2 font-medium">{supplier.name}</td>
                        <td className="px-4 py-2 text-right text-slate-600">{supplier.skus}</td>
                        <td className="px-4 py-2 text-right text-slate-600">{supplier.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-900">
                {selectedSuppliers.size} of {suppliers.length} suppliers selected
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setStep('confirm')}>
                Back
              </Button>
              <Button onClick={handleStart} disabled={selectedSuppliers.size === 0} className="bg-indigo-600 hover:bg-indigo-700">
                <Send className="w-4 h-4 mr-2" />
                Send to Telegram
              </Button>
            </div>
            </>
            )}

        {step === 'processing' && status && (
          <>
            <DialogHeader>
              <DialogTitle>Sending to Telegram</DialogTitle>
              <DialogDescription>
                Job ID: {jobId?.slice(0, 8)}... Status: {status.status}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Current supplier */}
              {status.currentSupplier && (
                <div className="bg-indigo-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-600 mb-1">Current Supplier</p>
                  <p className="text-sm font-semibold text-indigo-900">{status.currentSupplier}</p>
                  {status.lastSentAt && (
                    <p className="text-xs text-slate-500 mt-1">
                      Last sent: {new Date(status.lastSentAt).toLocaleTimeString()}
                    </p>
                  )}
                </div>
              )}

              {/* Progress bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Sent / Total</span>
                  <span className="font-semibold text-slate-900">
                    {status.sentItems || 0} / {status.totalItems}
                  </span>
                </div>
                <Progress value={Math.min(status.progressPercent || 0, 100)} className="h-2" />
                <p className="text-xs text-slate-500 text-center">{status.progressPercent || 0}%</p>
              </div>

              {/* Summary stats */}
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-green-50 rounded p-2 text-center">
                  <p className="text-xs text-slate-600">Sent</p>
                  <p className="text-lg font-bold text-green-600">{status.sentItems || 0}</p>
                </div>
                <div className="bg-blue-50 rounded p-2 text-center">
                  <p className="text-xs text-slate-600">Pending</p>
                  <p className="text-lg font-bold text-blue-600">{status.pendingItems || 0}</p>
                </div>
                <div className="bg-red-50 rounded p-2 text-center">
                  <p className="text-xs text-slate-600">Failed</p>
                  <p className="text-lg font-bold text-red-600">{status.failedItems || 0}</p>
                </div>
                <div className="bg-slate-50 rounded p-2 text-center">
                  <p className="text-xs text-slate-600">Total</p>
                  <p className="text-lg font-bold text-slate-900">{status.totalItems || 0}</p>
                </div>
              </div>

              {/* Status message */}
              <div className="flex items-center justify-center gap-2 text-slate-600">
                <Loader className="w-5 h-5 animate-spin" />
                <span className="text-sm">Processing {status.sentItems}/{status.totalItems} items...</span>
              </div>

              {/* Error message if any */}
              {status.errorMessage && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm text-red-800">
                    <span className="font-semibold">Error:</span> {status.errorMessage}
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {step === 'completed' && status && (
          <>
            <DialogHeader>
              <DialogTitle>
                {status.status === 'failed' ? '❌ Export Failed' : '✅ Export Complete'}
              </DialogTitle>
              <DialogDescription>Job ID: {jobId?.slice(0, 8)}...</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Status indicator */}
              <div className="flex items-center justify-center">
                {status.status === 'completed' && status.failedItems === 0 ? (
                  <div className="text-center space-y-2">
                    <CheckCircle2 className="w-16 h-16 text-emerald-600 mx-auto" />
                    <p className="text-lg font-semibold text-slate-900">
                      All items sent successfully!
                    </p>
                  </div>
                ) : status.status === 'completed' && status.failedItems > 0 ? (
                  <div className="text-center space-y-2">
                    <AlertCircle className="w-16 h-16 text-amber-600 mx-auto" />
                    <p className="text-lg font-semibold text-slate-900">
                      Export completed with {status.failedItems} failure(s)
                    </p>
                  </div>
                ) : (
                  <div className="text-center space-y-2">
                    <AlertCircle className="w-16 h-16 text-red-600 mx-auto" />
                    <p className="text-lg font-semibold text-slate-900">
                      Export stopped
                    </p>
                    {status.errorMessage && (
                      <p className="text-sm text-red-600 mb-2">{status.errorMessage}</p>
                    )}
                    <p className="text-sm text-slate-600">
                      Completed: {status.sentItems}/{status.totalItems} items ({status.progressPercent}%)
                    </p>
                  </div>
                )}
              </div>

              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-2 bg-slate-50 rounded-lg p-3">
                <div className="text-center">
                  <p className="text-xs text-slate-600">Total Items</p>
                  <p className="text-xl font-bold text-slate-900">{status.totalItems}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-600">Sent</p>
                  <p className="text-xl font-bold text-green-600">{status.sentItems || 0}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-600">Failed</p>
                  <p className="text-xl font-bold text-red-600">{status.failedItems || 0}</p>
                </div>
              </div>

              {/* Failed items - show errors */}
              {status.failedItems > 0 && status.failedItemsLog && status.failedItemsLog.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                  <p className="text-sm font-semibold text-red-900 mb-2">Failed Items:</p>
                  <div className="space-y-1">
                    {status.failedItemsLog.slice(0, 10).map((item, idx) => (
                      <div key={idx} className="text-xs text-red-800">
                        <p className="font-mono">SKU: {item.sku_code}</p>
                        <p className="text-red-700 ml-2">{item.error_message}</p>
                      </div>
                    ))}
                    {status.failedItemsLog.length > 10 && (
                      <p className="text-xs text-red-700 italic">...and {status.failedItemsLog.length - 10} more</p>
                    )}
                  </div>
                </div>
              )}

              {status.failedItems > 0 && (
                <Button
                  onClick={downloadFailedItems}
                  variant="outline"
                  className="w-full"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Failed Items CSV
                </Button>
              )}

              <div className="space-y-2">
                {status.canResume && status.pendingItems > 0 && (
                  <Button
                    onClick={handleResume}
                    disabled={resuming}
                    className="w-full bg-indigo-600 hover:bg-indigo-700"
                  >
                    {resuming ? (
                      <>
                        <Loader className="w-4 h-4 mr-2 animate-spin" />
                        Resuming...
                      </>
                    ) : (
                      `▶️ Resume (${status.pendingItems} pending)`
                    )}
                  </Button>
                )}
                
                {status.failedItems > 0 && (
                  <Button
                    onClick={handleRetryFailed}
                    variant="outline"
                    className="w-full border-amber-500 text-amber-700 hover:bg-amber-50"
                  >
                    🔄 Retry {status.failedItems} Failed Items
                  </Button>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              {status.status === 'failed' && (
                <Button variant="outline" onClick={onClose}>
                  Close & Resume Later
                </Button>
              )}
              {status.status !== 'failed' && (
                <Button onClick={onClose}>
                  Close
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}