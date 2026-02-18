import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { AlertTriangle, CheckCircle, Search, Download, RefreshCw } from 'lucide-react';
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
  const [reconciling, setReconciling] = useState(false);
  const [showReconcileDialog, setShowReconcileDialog] = useState(false);
  const [reconcilePreview, setReconcilePreview] = useState(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [fixingFlagged, setFixingFlagged] = useState(false);
  const [fixProgress, setFixProgress] = useState({ current: 0, total: 0, canResume: false, resumeIndex: 0 });
  const [fixResults, setFixResults] = useState(null);
  const [beforeAfterStats, setBeforeAfterStats] = useState(null);
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

  const exportFailedSkus = () => {
    if (!fixResults || !fixResults.failedSkus || fixResults.failedSkus.length === 0) return;

    const csv = [
      'SKU Code,Error Code,Reason,Failed Step,Details',
      ...fixResults.failedSkus.map(failed => {
        return `"${failed.sku_code}","${failed.error_code}","${failed.reason}","${failed.step}","${failed.details?.replace(/"/g, '""') || ''}"`;
      })
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `failed_skus_fix_${new Date().toISOString().split('T')[0]}.csv`;
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

  const handleFixFlaggedSkus = async (resumeFromIndex = 0) => {
    if (!results || results.issues.length === 0) return;

    setFixingFlagged(true);

    // Store before state
    if (resumeFromIndex === 0) {
      setBeforeAfterStats({
        before: {
          total_issues: results.total_issues,
          high_severity: results.high_severity,
          medium_severity: results.medium_severity
        },
        after: null
      });
      setFixResults(null); // Clear previous results
    }

    try {
      // Extract unique SKU codes from issues
      const skuCodes = [...new Set(results.issues.map(issue => issue.sku_code).filter(Boolean))];
      
      console.log(`[Frontend] Starting fix for ${skuCodes.length} SKUs, resume from ${resumeFromIndex}`);
      
      setFixProgress({ current: resumeFromIndex, total: skuCodes.length, canResume: false, resumeIndex: resumeFromIndex });

      toast({
        title: 'Fixing flagged SKUs...',
        description: `Processing ${skuCodes.length} SKUs in batches of 5 (slow but reliable)`,
      });

      const BATCH_SIZE = 5;
      const REQUEST_TIMEOUT = 30000; // 30 second timeout
      const MAX_RETRIES = 3;
      
      let currentIndex = resumeFromIndex;
      let totalProcessed = 0;
      let totalFailed = 0;
      let allFailedSkus = [];

      while (currentIndex < skuCodes.length) {
        let retryCount = 0;
        let batchSuccess = false;
        
        while (retryCount < MAX_RETRIES && !batchSuccess) {
          try {
            console.log(`[Frontend] Batch ${Math.floor(currentIndex/BATCH_SIZE) + 1}: Processing from index ${currentIndex} (attempt ${retryCount + 1}/${MAX_RETRIES})`);
            
            const batchStartTime = Date.now();
            
            // Create timeout promise
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Request timeout (25s)')), REQUEST_TIMEOUT)
            );
            
            // Make the request with timeout
            const requestPromise = base44.functions.invoke('fixFlaggedSkusToZero', {
              workspace_id: tenantId,
              sku_codes: skuCodes,
              start_index: currentIndex,
              batch_size: BATCH_SIZE
            });

            const { data } = await Promise.race([requestPromise, timeoutPromise]);
            
            const batchDuration = Date.now() - batchStartTime;
            console.log(`[Frontend] Batch completed in ${batchDuration}ms:`, data);

            if (data.ok) {
              totalProcessed += data.processedCount || 0;
              totalFailed += data.failedCount || 0;
              
              // CRITICAL: Capture failed SKUs immediately
              if (data.failed && Array.isArray(data.failed) && data.failed.length > 0) {
                allFailedSkus.push(...data.failed);
                console.log(`[Frontend] Batch failed SKUs:`, data.failed.length);
                
                // Update results in real-time so user sees progress
                setFixResults({
                  totalProcessed,
                  totalFailed,
                  failedSkus: allFailedSkus
                });
              }
              
              currentIndex = data.nextIndex;
              
              setFixProgress({ 
                current: totalProcessed + totalFailed, 
                total: skuCodes.length,
                canResume: false,
                resumeIndex: currentIndex
              });
              
              batchSuccess = true;
              
              if (data.done) {
                console.log('[Frontend] All batches completed');
                break;
              }
            } else {
              throw new Error(data.details || data.error || 'Batch failed');
            }
            
          } catch (error) {
            retryCount++;
            const isTimeout = error.message?.includes('timeout');
            
            console.error(`[Frontend] Batch attempt ${retryCount} failed:`, error.message);
            
            if (retryCount < MAX_RETRIES) {
              const backoffDelay = retryCount * 500; // 0.5s, 1s, 1.5s
              console.log(`[Frontend] Retrying in ${backoffDelay}ms...`);
              await new Promise(resolve => setTimeout(resolve, backoffDelay));
            } else {
              // Max retries reached
              setFixProgress({ 
                current: totalProcessed + totalFailed, 
                total: skuCodes.length,
                canResume: true,
                resumeIndex: currentIndex
              });
              
              throw new Error(
                `Failed after ${MAX_RETRIES} retries. ${isTimeout ? 'Request timed out.' : error.message}\n\nClick "Resume Fix" to continue from where it stopped.`
              );
            }
          }
        }
      }

      // All done
      setFixProgress({ current: 0, total: 0, canResume: false, resumeIndex: 0 });

      // Final results update
      const finalResults = {
        totalProcessed,
        totalFailed,
        failedSkus: allFailedSkus
      };
      
      setFixResults(finalResults);
      
      console.log('[Frontend] Final results:', finalResults);

      if (totalFailed === 0) {
        toast({
          title: '✓ Fixed all flagged SKUs',
          description: `Successfully reset ${totalProcessed} SKUs to 0 and archived their history`,
          duration: 6000
        });
      } else {
        toast({
          title: '⚠ Completed with failures',
          description: `Fixed: ${totalProcessed}, Failed: ${totalFailed}. Scroll down for detailed error report.`,
          variant: 'destructive',
          duration: 10000
        });
        console.error('[Frontend] Failed SKUs details:', allFailedSkus);
      }

      // Auto re-run integrity check and capture after state
      setTimeout(async () => {
        try {
          const newCheckResults = await runIntegrityCheckSilent();
          if (newCheckResults) {
            setResults(newCheckResults);
            setBeforeAfterStats(prev => ({
              ...prev,
              after: {
                total_issues: newCheckResults.total_issues || 0,
                high_severity: newCheckResults.high_severity || 0,
                medium_severity: newCheckResults.medium_severity || 0
              }
            }));
          }
        } catch (error) {
          console.error('Failed to re-run check after fix:', error);
        }
      }, 2000);

    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      
      toast({
        title: 'Fix failed',
        description: errorMsg,
        variant: 'destructive',
        duration: 15000
      });
      
      console.error('Fix flagged SKUs error:', error);
    } finally {
      setFixingFlagged(false);
    }
  };

  const handleFullReset = async () => {
    if (resetConfirmText !== 'RESET') {
      toast({
        title: 'Confirmation required',
        description: 'Please type RESET to confirm',
        variant: 'destructive'
      });
      return;
    }

    setShowResetConfirm(false);
    setReconciling(true);

    try {
      // Call backend function for atomic reset
      const { data } = await base44.functions.invoke('resetStockToZero', { 
        workspace_id: tenantId 
      });

      if (data.ok) {
        toast({
          title: '✓ Stock reset complete',
          description: `Reset ${data.skus_reset} SKUs to 0. Deleted ${data.movements_deleted} movements in ${Math.round(data.took_ms / 1000)}s.`,
          duration: 6000
        });

        // Auto re-run integrity check
        setTimeout(() => {
          runIntegrityCheck();
        }, 1000);
      } else {
        throw new Error(data.details || data.error || 'Reset failed');
      }
    } catch (error) {
      // Extract detailed error message
      const errorMsg = error.response?.data?.details || 
                      error.response?.data?.error || 
                      error.message || 
                      'Unknown error';
      
      const hint = error.response?.data?.hint || 
                  'Check logs: Dashboard → Code → Functions → resetStockToZero';
      
      toast({
        title: 'Reset failed',
        description: `${errorMsg}\n\n${hint}`,
        variant: 'destructive',
        duration: 10000
      });
      
      console.error('Reset error details:', error.response?.data || error);
    } finally {
      setReconciling(false);
      setResetConfirmText('');
    }
  };

  const reconcileAllStock = async () => {
    setReconciling(true);
    setShowReconcileDialog(false);

    try {
      const timestamp = new Date().toISOString();
      const referenceId = `reconcile_all_${timestamp}`;
      
      // FETCH ALL SKUs and stock movements (only active/non-archived)
      const [allSKUs, allMovements, allCurrentStock] = await Promise.all([
        base44.entities.SKU.filter({ tenant_id: tenantId }),
        base44.entities.StockMovement.filter({ tenant_id: tenantId, is_archived: false }),
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
              notes: `Global stock reconciliation: ${action.current_stock} → ${action.desired_stock} (history: ${action.calculated_stock}, clamped to 0 if negative)`,
              is_archived: false
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
                    <div className="flex gap-2 flex-wrap">
                      {fixProgress.canResume ? (
                        <Button 
                          size="sm"
                          onClick={() => handleFixFlaggedSkus(fixProgress.resumeIndex)}
                          disabled={fixingFlagged || reconciling}
                          className="bg-blue-600 hover:bg-blue-700 animate-pulse"
                        >
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Resume Fix from {fixProgress.resumeIndex}/{fixProgress.total}
                        </Button>
                      ) : (
                        <Button 
                          size="sm"
                          onClick={() => handleFixFlaggedSkus(0)}
                          disabled={fixingFlagged || reconciling}
                          className="bg-orange-600 hover:bg-orange-700"
                        >
                          <RefreshCw className={`w-4 h-4 mr-2 ${fixingFlagged ? 'animate-spin' : ''}`} />
                          {fixingFlagged ? `Fixing ${fixProgress.current}/${fixProgress.total}...` : 'Hard Reset (Fix Issues Only)'}
                        </Button>
                      )}
                      <Button 
                        size="sm"
                        onClick={() => setShowResetConfirm(true)}
                        disabled={reconciling || fixingFlagged}
                        className="bg-red-600 hover:bg-red-700"
                      >
                        <RefreshCw className={`w-4 h-4 mr-2 ${reconciling ? 'animate-spin' : ''}`} />
                        {reconciling ? 'Resetting...' : 'Full Reset to Zero (Fix All)'}
                      </Button>
                      {results.issues.some(i => i.type === 'stock_mismatch') && (
                        <Button 
                          size="sm"
                          onClick={prepareReconcilePreview}
                          disabled={reconciling || fixingFlagged}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          <RefreshCw className={`w-4 h-4 mr-2 ${reconciling ? 'animate-spin' : ''}`} />
                          {reconciling ? 'Reconciling...' : 'Reconcile Stock (Keep Values)'}
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

              {beforeAfterStats && beforeAfterStats.after && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                  <h4 className="font-semibold text-blue-900">Before vs After</h4>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-white rounded p-3 border border-blue-200">
                      <p className="text-xs text-slate-600 mb-1">Total Issues</p>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold text-red-700">{beforeAfterStats.before.total_issues}</span>
                        <span className="text-slate-400">→</span>
                        <span className="text-lg font-bold text-emerald-700">{beforeAfterStats.after.total_issues}</span>
                      </div>
                    </div>
                    <div className="bg-white rounded p-3 border border-blue-200">
                      <p className="text-xs text-slate-600 mb-1">High Severity</p>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold text-orange-700">{beforeAfterStats.before.high_severity}</span>
                        <span className="text-slate-400">→</span>
                        <span className="text-lg font-bold text-emerald-700">{beforeAfterStats.after.high_severity}</span>
                      </div>
                    </div>
                    <div className="bg-white rounded p-3 border border-blue-200">
                      <p className="text-xs text-slate-600 mb-1">Medium Severity</p>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold text-yellow-700">{beforeAfterStats.before.medium_severity}</span>
                        <span className="text-slate-400">→</span>
                        <span className="text-lg font-bold text-emerald-700">{beforeAfterStats.after.medium_severity}</span>
                      </div>
                    </div>
                  </div>
                  {beforeAfterStats.after.total_issues === 0 && (
                    <p className="text-sm text-emerald-700 font-semibold">✓ All issues resolved!</p>
                  )}
                </div>
              )}

              {fixResults && fixResults.failedSkus && fixResults.failedSkus.length > 0 && (
                <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-red-900 text-lg">❌ Failed SKUs Report</h4>
                      <p className="text-sm text-red-700 font-semibold">
                        {fixResults.failedSkus.length} SKU(s) failed to fix. Review details below.
                      </p>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={exportFailedSkus}
                      className="border-red-300 text-red-700 hover:bg-red-100"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Export Failed SKUs
                    </Button>
                  </div>
                  <div className="max-h-64 overflow-y-auto space-y-2 border-t-2 border-red-200 pt-3">
                    {fixResults.failedSkus.map((failed, idx) => (
                      <div key={idx} className="bg-white rounded border-2 border-red-300 p-3 text-sm">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-bold text-red-900 text-base">{failed.sku_code}</span>
                          <span className="px-2 py-1 text-xs font-bold bg-red-200 text-red-900 rounded">
                            {failed.error_code}
                          </span>
                        </div>
                        <p className="text-red-800 font-medium mb-1">{failed.reason}</p>
                        <p className="text-xs text-red-700 bg-red-50 p-2 rounded">
                          <strong>Step:</strong> {failed.step} | <strong>Details:</strong> {failed.details}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="bg-red-100 border border-red-300 rounded p-3 text-sm text-red-900">
                    <strong>💡 Troubleshooting:</strong> Most failures are due to rate limits or database timeouts. 
                    Try using "Resume Fix" button or run the fix during off-peak hours.
                  </div>
                </div>
              )}

              <Button 
                variant="outline" 
                onClick={() => {
                  console.log('[Run Check Again] Clicked - clearing state and running fresh check');
                  setResults(null);
                  setFixResults(null);
                  setBeforeAfterStats(null);
                  setFixProgress({ current: 0, total: 0, canResume: false, resumeIndex: 0 });
                  runIntegrityCheck();
                }}
                disabled={checking || reconciling || fixingFlagged}
                className="w-full"
              >
                <Search className={`w-4 h-4 mr-2 ${checking ? 'animate-spin' : ''}`} />
                {checking ? 'Checking...' : 'Run Check Again'}
              </Button>
            </>
          )}
        </div>
      </DialogContent>

      {/* Reconcile Confirmation Dialog */}
      <AlertDialog open={showReconcileDialog} onOpenChange={setShowReconcileDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reconcile Stock (Keep Values)?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-4">
              <p>
                This will adjust current stock to match movement history without resetting to zero.
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
                <strong>Note:</strong> This keeps existing stock values but adjusts them to match history.
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

      {/* Full Reset Confirmation Dialog */}
      <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Stock & Fix All Integrity Issues?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-red-900 mb-2">This will:</p>
                      <ul className="text-xs text-red-800 space-y-1 list-disc list-inside">
                        <li>Set ALL SKU stock to 0</li>
                        <li>Archive all previous movement history</li>
                        <li>Fix all integrity issues (mismatches, negative stock, missing movements)</li>
                        <li>Integrity Checker will show 0 issues after reset</li>
                        <li>This action is atomic but cannot be easily undone</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-sm text-blue-800">
                    <strong>Recommended:</strong> Export your data or create a backup before proceeding. This is useful for starting fresh inventory counts or fixing corrupted data.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-slate-700">
                    Type <strong className="text-red-600">RESET</strong> to confirm:
                  </Label>
                  <Input
                    value={resetConfirmText}
                    onChange={(e) => setResetConfirmText(e.target.value)}
                    placeholder="Type RESET"
                    className="font-mono"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setResetConfirmText('')}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleFullReset}
              disabled={resetConfirmText !== 'RESET'}
              className="bg-red-600 hover:bg-red-700"
            >
              Reset All Stock to Zero
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}