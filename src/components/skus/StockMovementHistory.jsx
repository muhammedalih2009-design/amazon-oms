import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { 
  TrendingUp, 
  TrendingDown, 
  Calendar, 
  FileText,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

export default function StockMovementHistory({ sku, tenantId, currentStock }) {
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (sku && tenantId) {
      loadMovements();
    }
  }, [sku, tenantId]);

  const loadMovements = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.StockMovement.filter({ 
        tenant_id: tenantId, 
        sku_id: sku.id 
      });
      
      // Sort by date descending (newest first)
      const sorted = data.sort((a, b) => 
        new Date(b.created_date) - new Date(a.created_date)
      );
      
      setMovements(sorted);
    } catch (error) {
      toast({
        title: 'Error loading history',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const [showManualReconcile, setShowManualReconcile] = useState(false);
  const [manualCount, setManualCount] = useState('');

  const handleRecalculateStock = async () => {
    setReconciling(true);
    try {
      // Calculate expected stock from movement history
      const calculatedStock = movements.reduce((total, movement) => {
        return total + (movement.quantity || 0);
      }, 0);

      // Get current stock
      const stock = currentStock.find(s => s.sku_id === sku.id);
      const currentQty = stock?.quantity_available || 0;

      // Check if they match
      if (calculatedStock === currentQty) {
        toast({
          title: '✓ Stock is accurate',
          description: `Current stock (${currentQty}) matches movement history total (${calculatedStock})`,
        });
      } else {
        // Show discrepancy - prompt for manual reconciliation
        setManualCount(currentQty.toString());
        setShowManualReconcile(true);
      }
    } catch (error) {
      toast({
        title: 'Reconciliation failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setReconciling(false);
    }
  };

  const handleManualReconcile = async () => {
    setReconciling(true);
    try {
      const physicalCount = parseInt(manualCount);
      if (isNaN(physicalCount) || physicalCount < 0) {
        toast({
          title: 'Invalid count',
          description: 'Please enter a valid number',
          variant: 'destructive'
        });
        return;
      }

      const calculatedStock = movements.reduce((total, movement) => {
        return total + (movement.quantity || 0);
      }, 0);

      const stock = currentStock.find(s => s.sku_id === sku.id);
      const currentQty = stock?.quantity_available || 0;
      const correction = physicalCount - calculatedStock;

      // Update stock to physical count
      if (stock) {
        await base44.entities.CurrentStock.update(stock.id, {
          quantity_available: physicalCount
        });

        // Create correction movement to balance history
        await base44.entities.StockMovement.create({
          tenant_id: tenantId,
          sku_id: sku.id,
          sku_code: sku.sku_code,
          movement_type: 'manual',
          quantity: correction,
          reference_type: 'manual',
          reference_id: null,
          movement_date: format(new Date(), 'yyyy-MM-dd'),
          notes: `Manual reconciliation: Physical count ${physicalCount}, System: ${currentQty}, History: ${calculatedStock}. Correction: ${correction > 0 ? '+' : ''}${correction}`
        });

        toast({
          title: 'Stock reconciled',
          description: `Stock set to ${physicalCount} units. Correction movement created (${correction > 0 ? '+' : ''}${correction})`,
        });

        setShowManualReconcile(false);
        setManualCount('');
        loadMovements();
      }
    } catch (error) {
      toast({
        title: 'Reconciliation failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setReconciling(false);
    }
  };

  const getMovementTypeLabel = (type) => {
    switch (type) {
      case 'purchase': return 'Purchase';
      case 'order_fulfillment': return 'Order Fulfillment';
      case 'return': return 'Return';
      case 'manual': return 'Manual Adjustment';
      case 'batch_delete': return 'Batch Deletion';
      default: return type;
    }
  };

  const getMovementTypeColor = (quantity) => {
    if (quantity > 0) {
      return 'text-emerald-600 bg-emerald-50 border-emerald-200';
    } else if (quantity < 0) {
      return 'text-red-600 bg-red-50 border-red-200';
    }
    return 'text-slate-600 bg-slate-50 border-slate-200';
  };

  const getMovementIcon = (quantity) => {
    if (quantity > 0) {
      return <TrendingUp className="w-4 h-4" />;
    } else if (quantity < 0) {
      return <TrendingDown className="w-4 h-4" />;
    }
    return <FileText className="w-4 h-4" />;
  };

  if (loading) {
    return (
      <div className="space-y-3 p-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="w-12 h-12 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const stock = currentStock.find(s => s.sku_id === sku.id);
  const currentQty = stock?.quantity_available || 0;
  const calculatedStock = movements.reduce((total, m) => total + (m.quantity || 0), 0);
  const isAccurate = calculatedStock === currentQty;

  return (
    <div className="space-y-4">
      {/* Header with Reconciliation */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold text-slate-900">Stock Movement History</h3>
            <p className="text-sm text-slate-600 mt-1">
              Complete audit trail of all stock changes
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRecalculateStock}
            disabled={reconciling}
            className="border-indigo-200 text-indigo-600 hover:bg-indigo-50"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${reconciling ? 'animate-spin' : ''}`} />
            Reconcile Stock
          </Button>
        </div>

        {/* Stock Status */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white border border-slate-200 rounded-lg p-3">
            <p className="text-xs text-slate-500 mb-1">Current Stock</p>
            <p className="text-2xl font-bold text-slate-900">{currentQty}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-3">
            <p className="text-xs text-slate-500 mb-1">Calculated Stock</p>
            <p className="text-2xl font-bold text-slate-900">{calculatedStock}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-3">
            <p className="text-xs text-slate-500 mb-1">Status</p>
            <div className="flex items-center gap-2 mt-1">
              {isAccurate ? (
                <>
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                  <span className="text-sm font-semibold text-emerald-600">Accurate</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-5 h-5 text-orange-600" />
                  <span className="text-sm font-semibold text-orange-600">Mismatch</span>
                </>
              )}
            </div>
          </div>
        </div>

        {!isAccurate && (
          <div className="mt-3 bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
            <p className="text-xs text-orange-800">
              <strong>Discrepancy detected:</strong> Current stock ({currentQty}) doesn't match movement history total ({calculatedStock}). 
              Click "Reconcile Stock" to fix.
            </p>
          </div>
        )}
      </div>

      {/* Movement Timeline */}
      <div className="space-y-2">
        {movements.length === 0 ? (
          <div className="text-center py-12 bg-slate-50 rounded-xl border border-slate-200">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-slate-900 mb-1">No movement history</h3>
            <p className="text-slate-500">
              Stock movements will appear here when purchases or orders are processed
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs font-semibold text-slate-500 uppercase mb-2">
              {movements.length} Movement{movements.length !== 1 ? 's' : ''}
            </p>
            {movements.map((movement, index) => {
              const quantity = movement.quantity || 0;
              const isPositive = quantity > 0;
              
              return (
                <div 
                  key={movement.id}
                  className={`border rounded-lg p-4 transition-all hover:shadow-sm ${getMovementTypeColor(quantity)}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1">
                      <div className={`w-10 h-10 rounded-lg border flex items-center justify-center ${getMovementTypeColor(quantity)}`}>
                        {getMovementIcon(quantity)}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-slate-900">
                            {getMovementTypeLabel(movement.movement_type)}
                          </h4>
                          <span className={`text-sm font-bold ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
                            {isPositive ? '+' : ''}{quantity}
                          </span>
                        </div>
                        
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs text-slate-600">
                            <Calendar className="w-3 h-3" />
                            <span>{format(new Date(movement.created_date), 'MMM d, yyyy h:mm a')}</span>
                          </div>
                          
                          {movement.reference_type && movement.reference_id && (
                            <div className="text-xs text-slate-600">
                              <span className="font-medium">Reference:</span>{' '}
                              {movement.reference_type} #{movement.reference_id.slice(0, 8)}
                            </div>
                          )}
                          
                          {movement.notes && (
                            <div className="text-xs text-slate-700 mt-2 bg-white/50 rounded p-2 border border-slate-200">
                              {movement.notes}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Manual Reconciliation Dialog */}
      <Dialog open={showManualReconcile} onOpenChange={setShowManualReconcile}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manual Stock Reconciliation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-2 text-sm">
                  <p className="font-semibold text-amber-900">Stock Discrepancy Detected</p>
                  <div className="space-y-1 text-amber-800">
                    <p>• <strong>Current Stock:</strong> {currentQty} units</p>
                    <p>• <strong>Movement History Total:</strong> {calculatedStock} units</p>
                    <p>• <strong>Difference:</strong> {calculatedStock - currentQty} units</p>
                  </div>
                  <p className="text-amber-700 mt-2">
                    {calculatedStock > currentQty 
                      ? '⚠ History shows more stock than system. Possible missing OUT movements (unfulfilled orders not logged).'
                      : '⚠ System shows more stock than history. Possible missing IN movements (purchases not logged).'}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="physical-count">Physical Count (Actual Inventory) *</Label>
              <Input
                id="physical-count"
                type="number"
                min="0"
                value={manualCount}
                onChange={(e) => setManualCount(e.target.value)}
                placeholder="Enter actual physical count"
                className="text-lg font-semibold"
              />
              <p className="text-xs text-slate-500">
                Count your actual physical inventory and enter the true number here. A correction movement will be created to balance the history.
              </p>
            </div>

            {manualCount && !isNaN(parseInt(manualCount)) && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                <p className="text-sm font-semibold text-indigo-900 mb-2">Reconciliation Preview:</p>
                <div className="text-sm text-indigo-800 space-y-1">
                  <p>• Stock will be set to: <strong>{parseInt(manualCount)}</strong> units</p>
                  <p>• Correction movement: <strong>{parseInt(manualCount) - calculatedStock > 0 ? '+' : ''}{parseInt(manualCount) - calculatedStock}</strong> units</p>
                  <p className="text-xs text-indigo-700 mt-2">
                    This will add a "Manual Adjustment" entry to balance the movement history.
                  </p>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowManualReconcile(false);
              setManualCount('');
            }}>
              Cancel
            </Button>
            <Button 
              onClick={handleManualReconcile}
              disabled={!manualCount || isNaN(parseInt(manualCount)) || reconciling}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {reconciling ? 'Reconciling...' : 'Confirm Reconciliation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}