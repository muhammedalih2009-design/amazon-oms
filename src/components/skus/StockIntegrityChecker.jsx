import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { AlertTriangle, CheckCircle, Search, Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
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

export default function StockIntegrityChecker({ tenantId, open, onClose }) {
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState(null);
  const [reconciling, setReconciling] = useState(false);
  const [showReconcileDialog, setShowReconcileDialog] = useState(false);
  const [reconcilePreview, setReconcilePreview] = useState(null);
  const { toast } = useToast();

  const runIntegrityCheck = async () => {
    setChecking(true);
    try {
      // Fetch all data
      const [orders, orderLines, movements, currentStock, skus] = await Promise.all([
        base44.entities.Order.filter({ tenant_id: tenantId }),
        base44.entities.OrderLine.filter({ tenant_id: tenantId }),
        base44.entities.StockMovement.filter({ tenant_id: tenantId }),
        base44.entities.CurrentStock.filter({ tenant_id: tenantId }),
        base44.entities.SKU.filter({ tenant_id: tenantId })
      ]);

      const issues = [];

      // Check 1: Fulfilled orders without OUT movements
      const fulfilledOrders = orders.filter(o => o.status === 'fulfilled');
      for (const order of fulfilledOrders) {
        const lines = orderLines.filter(l => l.order_id === order.id && !l.is_returned);
        
        for (const line of lines) {
          const hasMovement = movements.some(m => 
            m.reference_type === 'order_line' && 
            m.reference_id === line.id &&
            m.movement_type === 'order_fulfillment'
          );

          if (!hasMovement) {
            const sku = skus.find(s => s.id === line.sku_id);
            issues.push({
              type: 'missing_out_movement',
              severity: 'high',
              sku_code: line.sku_code || sku?.sku_code,
              sku_id: line.sku_id,
              order_id: order.amazon_order_id,
              quantity: line.quantity,
              description: `Order ${order.amazon_order_id} is fulfilled but missing OUT movement for ${line.quantity} units`
            });
          }
        }
      }

      // Check 2: Stock vs Movement History mismatch
      for (const stock of currentStock) {
        const sku = skus.find(s => s.id === stock.sku_id);
        const skuMovements = movements.filter(m => m.sku_id === stock.sku_id);
        const calculatedStock = skuMovements.reduce((sum, m) => sum + (m.quantity || 0), 0);
        
        if (calculatedStock !== stock.quantity_available) {
          const difference = Math.abs(calculatedStock - stock.quantity_available);
          issues.push({
            type: 'stock_mismatch',
            severity: difference > 10 ? 'high' : 'medium',
            sku_code: stock.sku_code || sku?.sku_code,
            sku_id: stock.sku_id,
            current_stock: stock.quantity_available,
            calculated_stock: calculatedStock,
            difference: calculatedStock - stock.quantity_available,
            description: `Stock mismatch: System shows ${stock.quantity_available}, history totals ${calculatedStock} (diff: ${calculatedStock - stock.quantity_available})`
          });
        }
      }

      // Check 3: Ghost items (negative or very small positive discrepancies)
      for (const stock of currentStock) {
        if (stock.quantity_available < 0) {
          issues.push({
            type: 'negative_stock',
            severity: 'high',
            sku_code: stock.sku_code,
            sku_id: stock.sku_id,
            current_stock: stock.quantity_available,
            description: `Negative stock: ${stock.quantity_available} units (should never happen)`
          });
        }
      }

      setResults({
        total_issues: issues.length,
        high_severity: issues.filter(i => i.severity === 'high').length,
        medium_severity: issues.filter(i => i.severity === 'medium').length,
        issues: issues.sort((a, b) => {
          const severityOrder = { high: 0, medium: 1, low: 2 };
          return severityOrder[a.severity] - severityOrder[b.severity];
        })
      });

      if (issues.length === 0) {
        toast({
          title: '✓ No issues found',
          description: 'All stock levels match movement history'
        });
      }
    } catch (error) {
      toast({
        title: 'Check failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setChecking(false);
    }
  };

  const exportResults = () => {
    if (!results || results.issues.length === 0) return;

    const csv = [
      'Severity,Type,SKU,Issue Description,Details',
      ...results.issues.map(issue => {
        const details = issue.type === 'stock_mismatch' 
          ? `Current: ${issue.current_stock}, History: ${issue.calculated_stock}, Diff: ${issue.difference}`
          : issue.type === 'missing_out_movement'
          ? `Order: ${issue.order_id}, Qty: ${issue.quantity}`
          : `Stock: ${issue.current_stock}`;
        
        return `"${issue.severity}","${issue.type}","${issue.sku_code}","${issue.description}","${details}"`;
      })
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock_integrity_report_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const prepareReconcilePreview = () => {
    if (!results || results.issues.length === 0) return;

    // Only get stock_mismatch issues
    const stockMismatches = results.issues.filter(i => i.type === 'stock_mismatch');
    
    if (stockMismatches.length === 0) {
      toast({
        title: 'No stock mismatches to reconcile',
        description: 'Only stock mismatches can be auto-reconciled',
        variant: 'destructive'
      });
      return;
    }

    let totalPositiveDelta = 0;
    let totalNegativeDelta = 0;

    stockMismatches.forEach(issue => {
      if (issue.difference > 0) {
        totalPositiveDelta += issue.difference;
      } else {
        totalNegativeDelta += Math.abs(issue.difference);
      }
    });

    setReconcilePreview({
      affectedSkus: stockMismatches.length,
      totalPositiveDelta,
      totalNegativeDelta,
      issues: stockMismatches
    });

    setShowReconcileDialog(true);
  };

  const reconcileAllStock = async () => {
    setReconciling(true);
    setShowReconcileDialog(false);

    try {
      const timestamp = new Date().toISOString();
      const referenceId = `reconcile_all_${timestamp}`;
      
      // FETCH ALL SKUs and stock movements to recalculate from scratch
      const [allSKUs, allMovements, allCurrentStock] = await Promise.all([
        base44.entities.SKU.filter({ tenant_id: tenantId }),
        base44.entities.StockMovement.filter({ tenant_id: tenantId }),
        base44.entities.CurrentStock.filter({ tenant_id: tenantId })
      ]);

      // Build map: sku_id -> calculated_stock from movement history
      const calculatedStockMap = new Map();
      allSKUs.forEach(sku => calculatedStockMap.set(sku.id, 0));

      allMovements.forEach(movement => {
        const current = calculatedStockMap.get(movement.sku_id) || 0;
        calculatedStockMap.set(movement.sku_id, current + (movement.quantity || 0));
      });

      // Build map: sku_id -> current stock record
      const currentStockMap = new Map();
      allCurrentStock.forEach(stock => {
        currentStockMap.set(stock.sku_id, stock);
      });

      let successCount = 0;
      let failCount = 0;
      const errors = [];
      const reconciliationActions = [];

      // Process in batches with retry logic
      const BATCH_SIZE = 10;
      const BATCH_DELAY = 500;
      const MAX_RETRIES = 3;

      // Prepare reconciliation actions for ALL SKUs
      for (const [skuId, calculatedStock] of calculatedStockMap) {
        // NEVER allow negative stock - clamp to 0
        const desiredStock = Math.max(0, calculatedStock);
        const stockRecord = currentStockMap.get(skuId);
        const currentStock = stockRecord?.quantity_available || 0;
        
        // Only reconcile if there's a difference
        if (currentStock !== desiredStock) {
          const sku = allSKUs.find(s => s.id === skuId);
          reconciliationActions.push({
            sku_id: skuId,
            sku_code: sku?.sku_code || 'Unknown',
            current_stock: currentStock,
            calculated_stock: calculatedStock,
            desired_stock: desiredStock,
            difference: desiredStock - currentStock,
            stock_record_id: stockRecord?.id
          });
        }
      }

      const reconcileSKU = async (action, retryCount = 0) => {
        try {
          // Create movement record for audit trail
          if (action.difference !== 0) {
            await base44.entities.StockMovement.create({
              tenant_id: tenantId,
              sku_id: action.sku_id,
              sku_code: action.sku_code,
              movement_type: 'manual',
              quantity: action.difference,
              reference_type: 'manual',
              reference_id: referenceId,
              movement_date: new Date().toISOString().split('T')[0],
              notes: `Global stock reconciliation: ${action.current_stock} → ${action.desired_stock} (history: ${action.calculated_stock}, clamped to 0 if negative)`
            });
          }

          // Update CurrentStock to desired value (clamped at 0)
          if (action.stock_record_id) {
            await base44.entities.CurrentStock.update(action.stock_record_id, {
              quantity_available: action.desired_stock
            });
          } else {
            // Create stock record if missing
            await base44.entities.CurrentStock.create({
              tenant_id: tenantId,
              sku_id: action.sku_id,
              sku_code: action.sku_code,
              quantity_available: action.desired_stock
            });
          }

          return { success: true };
        } catch (error) {
          const isRateLimit = error.message?.toLowerCase().includes('rate limit') || 
                             error.message?.toLowerCase().includes('too many requests');
          
          if (isRateLimit && retryCount < MAX_RETRIES) {
            const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 5000);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
            return reconcileSKU(action, retryCount + 1);
          }
          
          return { success: false, error: error.message };
        }
      };

      // Process in batches
      for (let i = 0; i < reconciliationActions.length; i += BATCH_SIZE) {
        const batch = reconciliationActions.slice(i, i + BATCH_SIZE);
        
        for (const action of batch) {
          const result = await reconcileSKU(action);
          
          if (result.success) {
            successCount++;
          } else {
            failCount++;
            errors.push({
              sku_code: action.sku_code,
              error: result.error
            });
          }
        }

        // Delay between batches to avoid rate limits
        if (i + BATCH_SIZE < reconciliationActions.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
        }
      }

      if (failCount === 0) {
        toast({
          title: '✓ Reconciliation Complete',
          description: `Successfully reconciled ${successCount} SKUs`
        });

        // Refresh the integrity check
        setTimeout(() => runIntegrityCheck(), 1000);
      } else if (successCount > 0) {
        toast({
          title: 'Partial Success',
          description: `Reconciled ${successCount} SKUs, ${failCount} failed. Check console for details.`,
          variant: 'destructive'
        });
        console.error('Reconciliation errors:', errors);
        
        // Still refresh to show updated state
        setTimeout(() => runIntegrityCheck(), 1000);
      } else {
        toast({
          title: 'Reconciliation Failed',
          description: `All ${failCount} SKUs failed to reconcile. Please try again or contact support.`,
          variant: 'destructive'
        });
        console.error('Reconciliation errors:', errors);
      }
    } catch (error) {
      toast({
        title: 'Reconciliation Failed',
        description: error.message,
        variant: 'destructive'
      });
      console.error('Reconciliation error:', error);
    } finally {
      setReconciling(false);
      setReconcilePreview(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Stock Integrity Checker</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <p className="text-sm text-slate-700 mb-3">
              This tool checks for common inventory discrepancies:
            </p>
            <ul className="text-sm text-slate-600 space-y-1 list-disc list-inside">
              <li>Fulfilled orders without stock movement records</li>
              <li>Stock levels that don't match movement history</li>
              <li>Negative stock (ghost items)</li>
            </ul>
          </div>

          {!results && (
            <Button 
              onClick={runIntegrityCheck} 
              disabled={checking}
              className="w-full bg-indigo-600 hover:bg-indigo-700"
            >
              <Search className="w-4 h-4 mr-2" />
              {checking ? 'Checking...' : 'Run Integrity Check'}
            </Button>
          )}

          {results && (
            <>
              {/* Summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className={`rounded-lg p-4 border ${
                  results.total_issues === 0 
                    ? 'bg-emerald-50 border-emerald-200' 
                    : 'bg-red-50 border-red-200'
                }`}>
                  <p className="text-xs text-slate-600 mb-1">Total Issues</p>
                  <p className="text-2xl font-bold text-slate-900">{results.total_issues}</p>
                </div>
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <p className="text-xs text-slate-600 mb-1">High Severity</p>
                  <p className="text-2xl font-bold text-orange-900">{results.high_severity}</p>
                </div>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-xs text-slate-600 mb-1">Medium Severity</p>
                  <p className="text-2xl font-bold text-yellow-900">{results.medium_severity}</p>
                </div>
              </div>

              {/* Issues List */}
              {results.issues.length > 0 ? (
                <>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-slate-700">
                      Found {results.issues.length} issue(s)
                    </p>
                    <div className="flex gap-2">
                      {results.issues.some(i => i.type === 'stock_mismatch') && (
                        <Button 
                          size="sm"
                          onClick={prepareReconcilePreview}
                          disabled={reconciling}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          <RefreshCw className={`w-4 h-4 mr-2 ${reconciling ? 'animate-spin' : ''}`} />
                          {reconciling ? 'Reconciling...' : 'Reconcile All Stock'}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={exportResults}>
                        <Download className="w-4 h-4 mr-2" />
                        Export CSV
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {results.issues.map((issue, idx) => (
                      <div 
                        key={idx}
                        className={`border rounded-lg p-3 ${
                          issue.severity === 'high' 
                            ? 'bg-red-50 border-red-200' 
                            : 'bg-yellow-50 border-yellow-200'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${
                            issue.severity === 'high' ? 'text-red-600' : 'text-yellow-600'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`px-2 py-0.5 text-xs font-semibold rounded ${
                                issue.severity === 'high'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-yellow-100 text-yellow-700'
                              }`}>
                                {issue.severity.toUpperCase()}
                              </span>
                              <span className="font-semibold text-slate-900">{issue.sku_code}</span>
                            </div>
                            <p className="text-sm text-slate-700">{issue.description}</p>
                            
                            {issue.type === 'stock_mismatch' && (
                              <div className="mt-2 text-xs bg-white/50 rounded p-2 space-y-1">
                                <p>Current Stock: <strong>{issue.current_stock}</strong></p>
                                <p>History Total: <strong>{issue.calculated_stock}</strong></p>
                                <p>Difference: <strong className={issue.difference > 0 ? 'text-red-700' : 'text-blue-700'}>
                                  {issue.difference > 0 ? '+' : ''}{issue.difference}
                                </strong></p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                    <p className="text-sm text-indigo-800">
                      <strong>Recommended Actions:</strong> Review each SKU with issues. Use the "Movement History" tab in SKU details to manually reconcile stock with physical count.
                    </p>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 bg-emerald-50 rounded-lg border border-emerald-200">
                  <CheckCircle className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
                  <h3 className="text-lg font-semibold text-emerald-900 mb-1">All Clear!</h3>
                  <p className="text-sm text-emerald-700">
                    No inventory discrepancies detected. All stock levels match movement history.
                  </p>
                </div>
              )}

              <Button 
                variant="outline" 
                onClick={() => {
                  setResults(null);
                  runIntegrityCheck();
                }}
                className="w-full"
              >
                <Search className="w-4 h-4 mr-2" />
                Run Check Again
              </Button>
            </>
          )}
        </div>
      </DialogContent>

      {/* Reconcile Confirmation Dialog */}
      <AlertDialog open={showReconcileDialog} onOpenChange={setShowReconcileDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reconcile All Stock?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-4">
              <p>
                This will automatically fix all stock mismatches by adjusting current stock to match movement history.
              </p>
              
              {reconcilePreview && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-slate-700">SKUs to reconcile:</span>
                    <span className="text-sm font-bold text-slate-900">{reconcilePreview.affectedSkus}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-slate-700">Total stock to add:</span>
                    <span className="text-sm font-bold text-green-700">+{reconcilePreview.totalPositiveDelta}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-slate-700">Total stock to remove:</span>
                    <span className="text-sm font-bold text-red-700">-{reconcilePreview.totalNegativeDelta}</span>
                  </div>
                </div>
              )}

              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
                <strong>Note:</strong> This action will create audit trail movement records for each adjustment. The operation processes in batches with retry logic to ensure reliability.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={reconcileAllStock}
              className="bg-green-600 hover:bg-green-700"
            >
              Reconcile All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}