import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { format } from 'date-fns';
import { RotateCcw, Search, Check, Package, Undo2 } from 'lucide-react';
import RefreshButton from '@/components/shared/RefreshButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import StatusBadge from '@/components/ui/StatusBadge';
import DataTable from '@/components/shared/DataTable';
import PaywallBanner from '@/components/ui/PaywallBanner';
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
import { Checkbox } from '@/components/ui/checkbox';

export default function Returns() {
  const { tenantId, subscription, isActive } = useTenant();
  const { toast } = useToast();
  const [orders, setOrders] = useState([]);
  const [orderLines, setOrderLines] = useState([]);
  const [stockMovements, setStockMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [returnLines, setReturnLines] = useState([]);
  const [selectedReturns, setSelectedReturns] = useState([]);
  const [showUndoDialog, setShowUndoDialog] = useState(false);
  const [skus, setSkus] = useState([]);

  useEffect(() => {
    if (tenantId) loadData();
  }, [tenantId]);

  const loadData = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    const [ordersData, linesData, movementsData, skusData] = await Promise.all([
      base44.entities.Order.filter({ tenant_id: tenantId }),
      base44.entities.OrderLine.filter({ tenant_id: tenantId }),
      base44.entities.StockMovement.filter({ tenant_id: tenantId, movement_type: 'return' }),
      base44.entities.SKU.filter({ tenant_id: tenantId })
    ]);
    setOrders(ordersData);
    setOrderLines(linesData);
    setStockMovements(movementsData.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)));
    setSkus(skusData);
    if (isRefresh) {
      setRefreshing(false);
    } else {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    const order = orders.find(o => 
      o.amazon_order_id?.toLowerCase() === search.toLowerCase()
    );
    
    if (!order) {
      toast({ title: 'Order not found', variant: 'destructive' });
      return;
    }

    if (order.status === 'pending') {
      toast({ title: 'Order not yet fulfilled', description: 'Only fulfilled orders can have returns', variant: 'destructive' });
      return;
    }

    setSelectedOrder(order);
    const lines = orderLines.filter(l => l.order_id === order.id);
    setReturnLines(lines.map(l => ({ ...l, selected: false, condition: 'sound' })));
  };

  const handleProcessReturn = async () => {
    const toReturn = returnLines.filter(l => l.selected && !l.is_returned);
    
    if (toReturn.length === 0) {
      toast({ title: 'Select items to return', variant: 'destructive' });
      return;
    }

    for (const line of toReturn) {
      const condition = line.condition || 'sound';
      
      // Mark line as returned
      await base44.entities.OrderLine.update(line.id, {
        is_returned: true,
        return_date: format(new Date(), 'yyyy-MM-dd')
      });

      // Update stock based on condition
      if (condition === 'sound') {
        // Add to main stock
        const stock = await base44.entities.CurrentStock.filter({ 
          tenant_id: tenantId, 
          sku_id: line.sku_id 
        });
        
        if (stock.length > 0) {
          await base44.entities.CurrentStock.update(stock[0].id, {
            quantity_available: (stock[0].quantity_available || 0) + line.quantity
          });
        } else {
          await base44.entities.CurrentStock.create({
            tenant_id: tenantId,
            sku_id: line.sku_id,
            sku_code: line.sku_code,
            quantity_available: line.quantity
          });
        }
      } else if (condition === 'damaged') {
        // Add to damaged stock in SKU table
        const skuRecords = await base44.entities.SKU.filter({ 
          tenant_id: tenantId, 
          id: line.sku_id 
        });
        
        if (skuRecords.length > 0) {
          const sku = skuRecords[0];
          await base44.entities.SKU.update(sku.id, {
            damaged_stock: (sku.damaged_stock || 0) + line.quantity
          });
        }
      }
      // If 'missing', no stock update (total loss)

      // Create stock movement with condition noted
      const conditionLabel = condition === 'sound' ? 'Sound (سليم)' :
                            condition === 'damaged' ? 'Damaged (هالك)' :
                            'Missing (مفقود)';
      
      await base44.entities.StockMovement.create({
        tenant_id: tenantId,
        sku_id: line.sku_id,
        sku_code: line.sku_code,
        movement_type: 'return',
        quantity: line.quantity,
        reference_type: 'order_line',
        reference_id: line.id,
        movement_date: format(new Date(), 'yyyy-MM-dd'),
        notes: `Return for order ${selectedOrder.amazon_order_id} - Condition: ${conditionLabel}`
      });
    }

    // Update order status
    const allLines = orderLines.filter(l => l.order_id === selectedOrder.id);
    const returnedCount = allLines.filter(l => l.is_returned || toReturn.find(r => r.id === l.id)).length;
    
    const newStatus = returnedCount === allLines.length ? 'fully_returned' : 'partially_returned';
    
    await base44.entities.Order.update(selectedOrder.id, { status: newStatus });

    toast({ title: 'Return processed successfully' });
    setSelectedOrder(null);
    setReturnLines([]);
    setSearch('');
    loadData();
  };

  const toggleLine = (index) => {
    const newLines = [...returnLines];
    newLines[index].selected = !newLines[index].selected;
    setReturnLines(newLines);
  };

  const updateLineCondition = (index, condition) => {
    const newLines = [...returnLines];
    newLines[index].condition = condition;
    setReturnLines(newLines);
  };

  const getReturnSummary = () => {
    const selected = returnLines.filter(l => l.selected && !l.is_returned);
    const counts = {
      sound: 0,
      damaged: 0,
      missing: 0
    };
    
    selected.forEach(line => {
      const condition = line.condition || 'sound';
      counts[condition] += line.quantity;
    });
    
    return counts;
  };

  const handleUndoReturn = async () => {
    if (selectedReturns.length === 0) {
      toast({ title: 'No returns selected', variant: 'destructive' });
      return;
    }

    try {
      for (const movementId of selectedReturns) {
        const movement = stockMovements.find(m => m.id === movementId);
        if (!movement) continue;

        // Find the order line
        const orderLine = orderLines.find(l => l.id === movement.reference_id);
        if (!orderLine) continue;

        // Mark line as not returned
        await base44.entities.OrderLine.update(orderLine.id, {
          is_returned: false,
          return_date: null
        });

        // Reverse stock change based on return condition
        const returnCondition = movement.notes?.includes('Sound') ? 'sound' :
                               movement.notes?.includes('Damaged') ? 'damaged' :
                               movement.notes?.includes('Lost') ? 'lost' : 'sound';

        if (returnCondition === 'sound') {
          // Deduct from main stock
          const stock = await base44.entities.CurrentStock.filter({ 
            tenant_id: tenantId, 
            sku_id: orderLine.sku_id 
          });
          
          if (stock.length > 0) {
            await base44.entities.CurrentStock.update(stock[0].id, {
              quantity_available: (stock[0].quantity_available || 0) - movement.quantity
            });
          }
        } else if (returnCondition === 'damaged') {
          // Deduct from damaged stock (if you have that field in SKU entity)
          const skus = await base44.entities.SKU.filter({ 
            tenant_id: tenantId, 
            id: orderLine.sku_id 
          });
          
          if (skus.length > 0) {
            const sku = skus[0];
            await base44.entities.SKU.update(sku.id, {
              damaged_stock: (sku.damaged_stock || 0) - movement.quantity
            });
          }
        }
        // If lost, no stock change needed

        // Delete the stock movement record
        await base44.entities.StockMovement.delete(movement.id);

        // Update order status
        const order = orders.find(o => o.id === orderLine.order_id);
        if (order) {
          const allLines = orderLines.filter(l => l.order_id === order.id);
          const stillReturnedCount = allLines.filter(l => 
            l.is_returned && l.id !== orderLine.id
          ).length;
          
          let newStatus = 'fulfilled';
          if (stillReturnedCount === allLines.length) {
            newStatus = 'fully_returned';
          } else if (stillReturnedCount > 0) {
            newStatus = 'partially_returned';
          }
          
          await base44.entities.Order.update(order.id, { status: newStatus });
        }
      }

      toast({ 
        title: 'Returns undone successfully',
        description: `Reversed ${selectedReturns.length} return(s)` 
      });
      setSelectedReturns([]);
      setShowUndoDialog(false);
      loadData();
    } catch (error) {
      toast({
        title: 'Error undoing returns',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const toggleSelectReturn = (movementId) => {
    if (selectedReturns.includes(movementId)) {
      setSelectedReturns(selectedReturns.filter(id => id !== movementId));
    } else {
      setSelectedReturns([...selectedReturns, movementId]);
    }
  };

  const toggleSelectAllReturns = () => {
    if (selectedReturns.length === returnHistory.length) {
      setSelectedReturns([]);
    } else {
      setSelectedReturns(returnHistory.map(r => r.id));
    }
  };

  // Return history from stock movements
  const returnHistory = stockMovements.map(m => {
    const orderLine = orderLines.find(l => l.id === m.reference_id);
    const order = orderLine ? orders.find(o => o.id === orderLine.order_id) : null;
    
    return {
      id: m.id,
      date: m.movement_date || m.created_date,
      order_number: order?.amazon_order_id || '-',
      sku_code: m.sku_code,
      quantity: m.quantity,
      notes: m.notes
    };
  });

  const historyColumns = [
    {
      key: 'select',
      header: (
        <Checkbox
          checked={selectedReturns.length === returnHistory.length && returnHistory.length > 0}
          onCheckedChange={toggleSelectAllReturns}
        />
      ),
      render: (_, row) => (
        <Checkbox
          checked={selectedReturns.includes(row.id)}
          onCheckedChange={() => toggleSelectReturn(row.id)}
        />
      )
    },
    {
      key: 'order_number',
      header: 'Order Number (رقم الأوردر)',
      render: (val) => <span className="font-semibold text-indigo-600">{val}</span>
    },
    {
      key: 'date',
      header: 'Date',
      sortable: true,
      render: (val) => format(new Date(val), 'MMM d, yyyy')
    },
    {
      key: 'sku_code',
      header: 'SKU',
      render: (val) => <span className="font-medium">{val}</span>
    },
    {
      key: 'quantity',
      header: 'Qty Returned',
      align: 'right',
      render: (val) => <span className="text-emerald-600 font-medium">+{val}</span>
    },
    {
      key: 'notes',
      header: 'Notes',
      render: (val) => <span className="text-slate-500">{val || '-'}</span>
    }
  ];

  return (
    <div className="space-y-6">
      <PaywallBanner subscription={subscription} onUpgrade={() => {}} />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Returns</h1>
          <p className="text-slate-500">Process order returns and restore inventory</p>
        </div>
        <div className="flex gap-3">
          {selectedReturns.length > 0 && (
            <Button 
              onClick={() => setShowUndoDialog(true)}
              variant="outline"
              className="border-orange-200 text-orange-600 hover:bg-orange-50"
            >
              <Undo2 className="w-4 h-4 mr-2" />
              Undo Selected ({selectedReturns.length})
            </Button>
          )}
          <RefreshButton onRefresh={() => loadData(true)} loading={refreshing} />
        </div>
      </div>

      {/* Search Section */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6">
        <h3 className="font-semibold text-slate-900 mb-4">Process Return</h3>
        <div className="flex gap-4 max-w-lg">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Enter Amazon Order ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="pl-10"
            />
          </div>
          <Button onClick={handleSearch} className="bg-indigo-600 hover:bg-indigo-700">
            Find Order
          </Button>
        </div>
      </div>

      {/* Return History */}
      <div>
        <h3 className="font-semibold text-slate-900 mb-4">Return History</h3>
        <DataTable
          columns={historyColumns}
          data={returnHistory}
          loading={loading}
          emptyIcon={RotateCcw}
          emptyTitle="No returns yet"
          emptyDescription="Process your first return by searching for an order above"
        />
      </div>

      {/* Undo Confirmation Dialog */}
      <AlertDialog open={showUndoDialog} onOpenChange={setShowUndoDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo Returns?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to undo <strong>{selectedReturns.length}</strong> return(s). 
              This will reverse the stock updates and set the orders back to 'Fulfilled'. 
              <br /><br />
              Stock changes will be reversed based on the original return condition:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li><strong>Sound (سليم):</strong> Deduct from main stock</li>
                <li><strong>Damaged (هالك):</strong> Deduct from damaged stock</li>
                <li><strong>Lost (مفقود):</strong> No stock change</li>
              </ul>
              <br />
              Proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleUndoReturn}
              className="bg-orange-600 hover:bg-orange-700"
            >
              Yes, Undo Return
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Return Dialog */}
      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Process Return</DialogTitle>
          </DialogHeader>
          
          {selectedOrder && (
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-lg p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-slate-500">Order ID</p>
                    <p className="font-medium">{selectedOrder.amazon_order_id}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Status</p>
                    <StatusBadge status={selectedOrder.status} />
                  </div>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-slate-700 mb-2">Select items to return and specify condition:</p>
                <div className="space-y-3">
                  {returnLines.map((line, i) => (
                    <div 
                      key={line.id}
                      className={`
                        rounded-lg border
                        ${line.is_returned ? 'bg-slate-50 opacity-60' : 'bg-white'}
                      `}
                    >
                      <div className="flex items-center gap-3 p-3">
                        <Checkbox
                          checked={line.selected}
                          onCheckedChange={() => toggleLine(i)}
                          disabled={line.is_returned}
                        />
                        <div className="flex-1">
                          <p className="font-medium">{line.sku_code}</p>
                          <p className="text-sm text-slate-500">Qty: {line.quantity}</p>
                        </div>
                        {line.is_returned && (
                          <StatusBadge status="fully_returned" />
                        )}
                      </div>
                      
                      {line.selected && !line.is_returned && (
                        <div className="px-3 pb-3 pt-0">
                          <p className="text-xs text-slate-500 mb-2">Return Condition:</p>
                          <div className="grid grid-cols-3 gap-2">
                            <button
                              type="button"
                              onClick={() => updateLineCondition(i, 'sound')}
                              className={`
                                flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all text-left
                                ${line.condition === 'sound' 
                                  ? 'border-emerald-500 bg-emerald-50' 
                                  : 'border-slate-200 hover:border-slate-300'}
                              `}
                            >
                              <span className={`text-xs font-semibold ${line.condition === 'sound' ? 'text-emerald-700' : 'text-slate-700'}`}>
                                Sound
                              </span>
                              <span className={`text-xs ${line.condition === 'sound' ? 'text-emerald-600' : 'text-slate-500'}`}>
                                سليم
                              </span>
                              <span className="text-[10px] text-slate-500 text-center mt-1">
                                → Main Stock
                              </span>
                            </button>
                            
                            <button
                              type="button"
                              onClick={() => updateLineCondition(i, 'damaged')}
                              className={`
                                flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all text-left
                                ${line.condition === 'damaged' 
                                  ? 'border-orange-500 bg-orange-50' 
                                  : 'border-slate-200 hover:border-slate-300'}
                              `}
                            >
                              <span className={`text-xs font-semibold ${line.condition === 'damaged' ? 'text-orange-700' : 'text-slate-700'}`}>
                                Damaged
                              </span>
                              <span className={`text-xs ${line.condition === 'damaged' ? 'text-orange-600' : 'text-slate-500'}`}>
                                هالك
                              </span>
                              <span className="text-[10px] text-slate-500 text-center mt-1">
                                → Damaged Stock
                              </span>
                            </button>
                            
                            <button
                              type="button"
                              onClick={() => updateLineCondition(i, 'missing')}
                              className={`
                                flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all text-left
                                ${line.condition === 'missing' 
                                  ? 'border-red-500 bg-red-50' 
                                  : 'border-slate-200 hover:border-slate-300'}
                              `}
                            >
                              <span className={`text-xs font-semibold ${line.condition === 'missing' ? 'text-red-700' : 'text-slate-700'}`}>
                                Missing
                              </span>
                              <span className={`text-xs ${line.condition === 'missing' ? 'text-red-600' : 'text-slate-500'}`}>
                                مفقود
                              </span>
                              <span className="text-[10px] text-slate-500 text-center mt-1">
                                → No Stock
                              </span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {returnLines.some(l => l.selected && !l.is_returned) && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                  <p className="text-sm font-medium text-indigo-900 mb-1">Return Summary:</p>
                  <div className="flex gap-4 text-xs text-indigo-700">
                    {getReturnSummary().sound > 0 && (
                      <span>✓ {getReturnSummary().sound} Sound</span>
                    )}
                    {getReturnSummary().damaged > 0 && (
                      <span>⚠ {getReturnSummary().damaged} Damaged</span>
                    )}
                    {getReturnSummary().missing > 0 && (
                      <span>✗ {getReturnSummary().missing} Missing</span>
                    )}
                  </div>
                  <p className="text-xs text-indigo-600 mt-1">
                    Confirm to process return with these conditions
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <Button variant="outline" onClick={() => setSelectedOrder(null)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleProcessReturn}
                  className="bg-indigo-600 hover:bg-indigo-700"
                  disabled={!returnLines.some(l => l.selected && !l.is_returned)}
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Process Return
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}