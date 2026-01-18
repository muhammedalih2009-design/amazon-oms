import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { format } from 'date-fns';
import { RotateCcw, Search, Check, Package } from 'lucide-react';
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

  useEffect(() => {
    if (tenantId) loadData();
  }, [tenantId]);

  const loadData = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    const [ordersData, linesData, movementsData] = await Promise.all([
      base44.entities.Order.filter({ tenant_id: tenantId }),
      base44.entities.OrderLine.filter({ tenant_id: tenantId }),
      base44.entities.StockMovement.filter({ tenant_id: tenantId, movement_type: 'return' })
    ]);
    setOrders(ordersData);
    setOrderLines(linesData);
    setStockMovements(movementsData.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)));
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
    setReturnLines(lines.map(l => ({ ...l, selected: false })));
  };

  const handleProcessReturn = async () => {
    const toReturn = returnLines.filter(l => l.selected && !l.is_returned);
    
    if (toReturn.length === 0) {
      toast({ title: 'Select items to return', variant: 'destructive' });
      return;
    }

    for (const line of toReturn) {
      // Mark line as returned
      await base44.entities.OrderLine.update(line.id, {
        is_returned: true,
        return_date: format(new Date(), 'yyyy-MM-dd')
      });

      // Update stock
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

      // Create stock movement
      await base44.entities.StockMovement.create({
        tenant_id: tenantId,
        sku_id: line.sku_id,
        sku_code: line.sku_code,
        movement_type: 'return',
        quantity: line.quantity,
        reference_type: 'order_line',
        reference_id: line.id,
        movement_date: format(new Date(), 'yyyy-MM-dd'),
        notes: `Return for order ${selectedOrder.amazon_order_id}`
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

  // Return history from stock movements
  const returnHistory = stockMovements.map(m => ({
    id: m.id,
    date: m.movement_date || m.created_date,
    sku_code: m.sku_code,
    quantity: m.quantity,
    notes: m.notes
  }));

  const historyColumns = [
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
        <RefreshButton onRefresh={() => loadData(true)} loading={refreshing} />
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
                <p className="text-sm font-medium text-slate-700 mb-2">Select items to return:</p>
                <div className="space-y-2">
                  {returnLines.map((line, i) => (
                    <div 
                      key={line.id}
                      className={`
                        flex items-center justify-between p-3 rounded-lg border
                        ${line.is_returned ? 'bg-slate-50 opacity-60' : 'bg-white hover:bg-slate-50'}
                      `}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={line.selected}
                          onCheckedChange={() => toggleLine(i)}
                          disabled={line.is_returned}
                        />
                        <div>
                          <p className="font-medium">{line.sku_code}</p>
                          <p className="text-sm text-slate-500">Qty: {line.quantity}</p>
                        </div>
                      </div>
                      {line.is_returned && (
                        <StatusBadge status="fully_returned" />
                      )}
                    </div>
                  ))}
                </div>
              </div>

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