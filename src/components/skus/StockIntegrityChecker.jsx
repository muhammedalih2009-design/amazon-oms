import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { AlertTriangle, CheckCircle, Search, Download, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  const [fixingSkus, setFixingSkus] = useState(new Set());
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileStock, setReconcileStock] = useState('0');
  const [reconciling, setReconciling] = useState(false);
  const { toast } = useToast();

  const runIntegrityCheckSilent = async () => {
    try {
      // Fetch all data including tenant for last_stock_reset_at
      const [orders, orderLines, movements, currentStock, skus, tenantData] = await Promise.all([
        base44.entities.Order.filter({ tenant_id: tenantId }),
        base44.entities.OrderLine.filter({ tenant_id: tenantId }),
        base44.entities.StockMovement.filter({ tenant_id: tenantId }),
        base44.entities.CurrentStock.filter({ tenant_id: tenantId }),
        base44.entities.SKU.filter({ tenant_id: tenantId }),
        base44.entities.Tenant.filter({ id: tenantId })
      ]);

      const tenant = tenantData[0];
      const lastResetAt = tenant?.last_stock_reset_at ? new Date(tenant.last_stock_reset_at) : null;
      const activeMovements = movements.filter(m => !m.is_archived);
      const issues = [];

      const fulfilledOrders = orders.filter(o => {
        if (o.status !== 'fulfilled') return false;
        if (lastResetAt) {
          const orderDate = new Date(o.order_date || o.created_date);
          return orderDate > lastResetAt;
        }
        return true;
      });
      
      for (const order of fulfilledOrders) {
        const lines = orderLines.filter(l => l.order_id === order.id && !l.is_returned);
        for (const line of lines) {
          const hasMovement = activeMovements.some(m => 
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

      for (const stock of currentStock) {
        const sku = skus.find(s => s.id === stock.sku_id);
        const skuMovements = activeMovements.filter(m => m.sku_id === stock.sku_id);
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

      const newResults = {
        total_issues: issues.length,
        high_severity: issues.filter(i => i.severity === 'high').length,
        medium_severity: issues.filter(i => i.severity === 'medium').length,
        issues: issues.sort((a, b) => {
          const severityOrder = { high: 0, medium: 1, low: 2 };
          return severityOrder[a.severity] - severityOrder[b.severity];
        })
      };

      setResults(newResults);
      return newResults;
    } catch (error) {
      console.error('Silent check failed:', error);
      return null;
    }
  };

  const runIntegrityCheck = async () => {
    setChecking(true);
    try {
      // Fetch all data including tenant for last_stock_reset_at
      const [orders, orderLines, movements, currentStock, skus, tenantData] = await Promise.all([
        base44.entities.Order.filter({ tenant_id: tenantId }),
        base44.entities.OrderLine.filter({ tenant_id: tenantId }),
        base44.entities.StockMovement.filter({ tenant_id: tenantId }),
        base44.entities.CurrentStock.filter({ tenant_id: tenantId }),
        base44.entities.SKU.filter({ tenant_id: tenantId }),
        base44.entities.Tenant.filter({ id: tenantId })
      ]);

      const tenant = tenantData[0];
      const lastResetAt = tenant?.last_stock_reset_at ? new Date(tenant.last_stock_reset_at) : null;
      
      // Filter to only non-archived movements
      const activeMovements = movements.filter(m => !m.is_archived);

      const issues = [];

      // Check 1: Fulfilled orders without OUT movements
      // Only check orders created/fulfilled AFTER last reset
      const fulfilledOrders = orders.filter(o => {
        if (o.status !== 'fulfilled') return false;
        
        // If there was a reset, only check orders after that reset
        if (lastResetAt) {
          const orderDate = new Date(o.order_date || o.created_date);
          return orderDate > lastResetAt;
        }
        
        return true;
      });
      
      for (const order of fulfilledOrders) {
        const lines = orderLines.filter(l => l.order_id === order.id && !l.is_returned);
        
        for (const line of lines) {
          const hasMovement = activeMovements.some(m => 
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

      // Check 2: Stock vs Movement History mismatch (using only active movements)
      for (const stock of currentStock) {
        const sku = skus.find(s => s.id === stock.sku_id);
        const skuMovements = activeMovements.filter(m => m.sku_id === stock.sku_id);
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

      // Check 3: Negative stock (should NEVER happen)
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

  const handleFixSingleSku = async (skuCode) => {
    if (!skuCode) return;

    console.log(`[UI] Starting fix for ${skuCode}`);
    setFixingSkus(prev => new Set(prev).add(skuCode));

    try {
      const { data } = await base44.functions.invoke('fixStockIssuesForSku', {
        workspace_id: tenantId,
        sku_code: skuCode
      });

      console.log(`[UI] Fix response for ${skuCode}:`, data);

      if (data.ok) {
        toast({
          title: '✓ Reconciled',
          description: `${skuCode}: Stock reconciled from ${data.before} to ${data.after}`,
          duration: 5000
        });

        // Wait longer before rechecking to ensure database has committed (5 seconds)
        setTimeout(async () => {
          console.log(`[UI] Rechecking integrity after fixing ${skuCode}`);
          try {
            const newResults = await runIntegrityCheckSilent();
            if (newResults) {
              console.log(`[UI] New check results:`, {
                total: newResults.total_issues,
                has_sku: newResults.issues.some(i => i.sku_code === skuCode)
              });
              setResults(newResults);
            }
          } catch (recheckerror) {
            console.error(`[UI] Recheck error:`, recheckerror);
          }
        }, 5000);
      } else {
        throw new Error(data.error || 'Fix failed');
      }
    } catch (error) {
      console.error(`[UI] Fix error for ${skuCode}:`, error);
      toast({
        title: 'Fix failed',
        description: `${skuCode}: ${error.message || 'Unknown error'}`,
        variant: 'destructive',
        duration: 5000
      });
    } finally {
      setTimeout(() => {
        setFixingSkus(prev => {
          const next = new Set(prev);
          next.delete(skuCode);
          return next;
        });
      }, 3000);
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
                    <Button variant="outline" size="sm" onClick={exportResults}>
                      <Download className="w-4 h-4 mr-2" />
                      Export CSV
                    </Button>
                  </div>

                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {results.issues.map((issue, idx) => {
                      const isFixing = fixingSkus.has(issue.sku_code);
                      return (
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
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <div className="flex items-center gap-2">
                                  <span className={`px-2 py-0.5 text-xs font-semibold rounded ${
                                    issue.severity === 'high'
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-yellow-100 text-yellow-700'
                                  }`}>
                                    {issue.severity.toUpperCase()}
                                  </span>
                                  <span className="font-semibold text-slate-900">{issue.sku_code}</span>
                                </div>
                                <Button
                                  size="sm"
                                  onClick={() => handleFixSingleSku(issue.sku_code)}
                                  disabled={isFixing}
                                  className={`${
                                    issue.severity === 'high'
                                      ? 'bg-red-600 hover:bg-red-700'
                                      : 'bg-yellow-600 hover:bg-yellow-700'
                                  } text-white text-xs px-3 py-1`}
                                >
                                  {isFixing ? (
                                    <>
                                      <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                                      Fixing...
                                    </>
                                  ) : (
                                    'FIX NOW'
                                  )}
                                </Button>
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
                      );
                    })}
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
                disabled={checking}
                className="w-full"
              >
                <Search className={`w-4 h-4 mr-2 ${checking ? 'animate-spin' : ''}`} />
                {checking ? 'Checking...' : 'Run Check Again'}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}