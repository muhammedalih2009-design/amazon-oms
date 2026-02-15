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
  const [step, setStep] = useState('confirm'); // confirm, processing, completed
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState(null);
  const [polling, setPolling] = useState(false);

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

        if (response.data.status === 'completed' || response.data.status === 'failed') {
          setStep('completed');
          setPolling(false);
          clearInterval(interval);
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 1000);

    return () => clearInterval(interval);
  };

  const handleStart = async () => {
    try {
      const response = await base44.functions.invoke('startTelegramExport', {
        tenantId,
        rows: items.map(item => ({
          imageUrl: item.image_url || '',
          supplier: item.supplier || 'Unassigned',
          sku: item.sku_code || '',
          product: item.product_name || '',
          toBuy: Number(item.to_buy || 0),
          unitCost: Number(item.cost_price || 0)
        })),
        dateRange
      });

      setJobId(response.data.jobId);
      setStep('processing');
      
      toast({
        title: 'Export Started',
        description: 'Sending items to Telegram...'
      });
    } catch (error) {
      toast({
        title: 'Failed to Start Export',
        description: error.message,
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
              <Button onClick={handleStart} className="bg-indigo-600 hover:bg-indigo-700">
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
                {status.currentSupplier && `Processing: ${status.currentSupplier}`}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Progress</span>
                  <span className="font-semibold text-slate-900">
                    {status.sentItems} / {status.totalItems}
                  </span>
                </div>
                <Progress value={progressPercent} className="h-2" />
                <p className="text-xs text-slate-500 text-center">{progressPercent}%</p>
              </div>

              <div className="flex items-center justify-center gap-2 text-slate-600">
                <Loader className="w-5 h-5 animate-spin" />
                <span className="text-sm">Sending items...</span>
              </div>

              {status.failedItems > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-sm text-amber-800">
                    {status.failedItems} item(s) failed to send
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {step === 'completed' && status && (
          <>
            <DialogHeader>
              <DialogTitle>Export Complete</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="flex items-center justify-center">
                {status.failedItems === 0 ? (
                  <div className="text-center space-y-2">
                    <CheckCircle2 className="w-16 h-16 text-emerald-600 mx-auto" />
                    <p className="text-lg font-semibold text-slate-900">
                      All items sent successfully!
                    </p>
                    <div className="text-sm text-slate-600 space-y-1">
                      <p>📸 Photos: {status.photoSentCount || 0}</p>
                      <p>📝 Text: {status.textFallbackCount || 0}</p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center space-y-2">
                    <AlertCircle className="w-16 h-16 text-amber-600 mx-auto" />
                    <p className="text-lg font-semibold text-slate-900">
                      Export completed with errors
                    </p>
                    <div className="text-sm text-slate-600 space-y-1">
                      <p>📸 Photos: {status.photoSentCount || 0}</p>
                      <p>📝 Text: {status.textFallbackCount || 0}</p>
                      <p>✗ Failed: {status.failedItems} items</p>
                    </div>
                  </div>
                )}
              </div>

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
            </div>

            <div className="flex justify-end">
              <Button onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}