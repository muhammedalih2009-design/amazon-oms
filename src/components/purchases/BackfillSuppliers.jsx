import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

export default function BackfillSuppliers({ tenantId, onComplete }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, updated: 0 });
  const [completed, setCompleted] = useState(false);
  const { toast } = useToast();

  const runBackfill = async () => {
    setLoading(true);
    setCompleted(false);
    
    try {
      // Get all SKUs and Purchases for this tenant
      const [skus, purchases] = await Promise.all([
        base44.entities.SKU.filter({ tenant_id: tenantId }),
        base44.entities.Purchase.filter({ tenant_id: tenantId })
      ]);

      setProgress({ current: 0, total: skus.length, updated: 0 });
      let updatedCount = 0;

      // For each SKU, find its most recent purchase and update supplier
      for (let i = 0; i < skus.length; i++) {
        const sku = skus[i];
        
        // Find most recent purchase for this SKU
        const skuPurchases = purchases
          .filter(p => p.sku_id === sku.id)
          .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

        if (skuPurchases.length > 0 && skuPurchases[0].supplier_id) {
          // Update SKU with latest supplier
          await base44.entities.SKU.update(sku.id, {
            supplier_id: skuPurchases[0].supplier_id
          });
          updatedCount++;
        }

        setProgress({ current: i + 1, total: skus.length, updated: updatedCount });
        
        // Small delay to avoid rate limiting
        if (i < skus.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      setCompleted(true);
      toast({
        title: 'Backfill completed',
        description: `Updated ${updatedCount} SKUs with latest supplier information`
      });
      
      if (onComplete) {
        onComplete();
      }
    } catch (error) {
      toast({
        title: 'Backfill failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="border-indigo-200 text-indigo-600"
      >
        <RefreshCw className="w-4 h-4 mr-2" />
        Sync Suppliers
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Backfill Latest Suppliers</DialogTitle>
            <DialogDescription>
              This will update all SKUs to reflect their most recent purchase supplier.
            </DialogDescription>
          </DialogHeader>

          {!loading && !completed && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                  <div className="text-sm text-blue-800">
                    <p className="font-medium mb-1">What this does:</p>
                    <ul className="list-disc list-inside space-y-1 text-xs">
                      <li>Finds the most recent purchase for each SKU</li>
                      <li>Updates the SKU's supplier to match that purchase</li>
                      <li>Ensures all SKUs show their latest supplier</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={runBackfill}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  Start Backfill
                </Button>
              </div>
            </div>
          )}

          {loading && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Processing SKUs...</span>
                  <span className="font-medium text-slate-900">
                    {progress.current} / {progress.total}
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-indigo-600 transition-all duration-300"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500">
                  Updated {progress.updated} SKUs with supplier information
                </p>
              </div>
            </div>
          )}

          {completed && (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div className="text-sm text-emerald-800">
                    <p className="font-medium">Backfill completed successfully!</p>
                    <p className="text-xs mt-1">
                      Updated {progress.updated} out of {progress.total} SKUs
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={() => setOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}