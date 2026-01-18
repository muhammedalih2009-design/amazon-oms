import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { format } from 'date-fns';
import { ShoppingCart, Plus, Search, Eye, Trash2, Play, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import DataTable from '@/components/shared/DataTable';
import CSVUploader from '@/components/shared/CSVUploader';
import BatchHistory from '@/components/shared/BatchHistory';
import StatusBadge from '@/components/ui/StatusBadge';
import PaywallBanner from '@/components/ui/PaywallBanner';
import UploadRequirementsBanner from '@/components/skus/UploadRequirementsBanner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';

export default function Orders() {
  const { tenantId, subscription, isActive } = useTenant();
  const { toast } = useToast();
  const [orders, setOrders] = useState([]);
  const [orderLines, setOrderLines] = useState([]);
  const [skus, setSkus] = useState([]);
  const [batches, setBatches] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [batchFilter, setBatchFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [showDetails, setShowDetails] = useState(null);
  const [deleteBatch, setDeleteBatch] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [formData, setFormData] = useState({
    amazon_order_id: '',
    order_date: '',
    lines: [{ sku_id: '', quantity: 1 }]
  });

  useEffect(() => {
    if (tenantId) loadData();
  }, [tenantId]);

  const loadData = async () => {
    setLoading(true);
    const [ordersData, linesData, skusData, batchesData, purchasesData] = await Promise.all([
      base44.entities.Order.filter({ tenant_id: tenantId }),
      base44.entities.OrderLine.filter({ tenant_id: tenantId }),
      base44.entities.SKU.filter({ tenant_id: tenantId }),
      base44.entities.ImportBatch.filter({ tenant_id: tenantId, batch_type: 'orders' }),
      base44.entities.Purchase.filter({ tenant_id: tenantId })
    ]);
    setOrders(ordersData);
    setOrderLines(linesData);
    setSkus(skusData);
    setBatches(batchesData.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)));
    setPurchases(purchasesData);
    setLoading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const order = await base44.entities.Order.create({
      tenant_id: tenantId,
      amazon_order_id: formData.amazon_order_id,
      order_date: formData.order_date,
      status: 'pending'
    });

    for (const line of formData.lines) {
      if (line.sku_id && line.quantity > 0) {
        const sku = skus.find(s => s.id === line.sku_id);
        await base44.entities.OrderLine.create({
          tenant_id: tenantId,
          order_id: order.id,
          sku_id: line.sku_id,
          sku_code: sku?.sku_code,
          quantity: parseInt(line.quantity)
        });
      }
    }

    setShowForm(false);
    setFormData({ amazon_order_id: '', order_date: '', lines: [{ sku_id: '', quantity: 1 }] });
    loadData();
    toast({ title: 'Order created successfully' });
  };

  const handleFulfillOrder = async (order) => {
    const lines = orderLines.filter(l => l.order_id === order.id && !l.is_returned);
    let totalCost = 0;
    let canFulfill = true;

    // Check stock and allocate FIFO
    for (const line of lines) {
      const skuPurchases = purchases
        .filter(p => p.sku_id === line.sku_id && (p.quantity_remaining || 0) > 0)
        .sort((a, b) => new Date(a.purchase_date) - new Date(b.purchase_date));

      let remaining = line.quantity;
      let lineCost = 0;

      for (const purchase of skuPurchases) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, purchase.quantity_remaining || 0);
        lineCost += take * purchase.cost_per_unit;
        remaining -= take;
      }

      if (remaining > 0) {
        canFulfill = false;
        toast({ 
          title: 'Cannot fulfill order', 
          description: `Insufficient stock for SKU: ${line.sku_code}`,
          variant: 'destructive'
        });
        break;
      }

      totalCost += lineCost;
    }

    if (!canFulfill) return;

    // Deduct stock using FIFO
    for (const line of lines) {
      const skuPurchases = purchases
        .filter(p => p.sku_id === line.sku_id && (p.quantity_remaining || 0) > 0)
        .sort((a, b) => new Date(a.purchase_date) - new Date(b.purchase_date));

      let remaining = line.quantity;
      let lineCost = 0;

      for (const purchase of skuPurchases) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, purchase.quantity_remaining || 0);
        lineCost += take * purchase.cost_per_unit;
        
        await base44.entities.Purchase.update(purchase.id, {
          quantity_remaining: (purchase.quantity_remaining || 0) - take
        });
        
        remaining -= take;
      }

      await base44.entities.OrderLine.update(line.id, {
        unit_cost: lineCost / line.quantity,
        line_total_cost: lineCost
      });

      // Update current stock
      const stock = await base44.entities.CurrentStock.filter({ 
        tenant_id: tenantId, 
        sku_id: line.sku_id 
      });
      
      if (stock.length > 0) {
        await base44.entities.CurrentStock.update(stock[0].id, {
          quantity_available: (stock[0].quantity_available || 0) - line.quantity
        });
      }

      // Create stock movement
      await base44.entities.StockMovement.create({
        tenant_id: tenantId,
        sku_id: line.sku_id,
        sku_code: line.sku_code,
        movement_type: 'order_fulfillment',
        quantity: -line.quantity,
        reference_type: 'order_line',
        reference_id: line.id,
        movement_date: format(new Date(), 'yyyy-MM-dd')
      });
    }

    await base44.entities.Order.update(order.id, {
      status: 'fulfilled',
      total_cost: totalCost,
      profit_loss: (order.net_revenue || 0) - totalCost,
      profit_margin_percent: order.net_revenue ? (((order.net_revenue - totalCost) / order.net_revenue) * 100) : null
    });

    loadData();
    toast({ title: 'Order fulfilled successfully' });
  };

  const handleDeleteOrder = async (order) => {
    // Delete order lines
    const lines = orderLines.filter(l => l.order_id === order.id);
    for (const line of lines) {
      await base44.entities.OrderLine.delete(line.id);
    }
    await base44.entities.Order.delete(order.id);
    loadData();
    toast({ title: 'Order deleted' });
  };

  const handleDeleteBatch = async () => {
    if (!deleteBatch) return;
    
    const batchOrders = orders.filter(o => o.import_batch_id === deleteBatch.id);
    
    for (const order of batchOrders) {
      // Reverse stock movements if fulfilled
      if (order.status === 'fulfilled') {
        const lines = orderLines.filter(l => l.order_id === order.id);
        for (const line of lines) {
          // Restore stock
          const stock = await base44.entities.CurrentStock.filter({ 
            tenant_id: tenantId, 
            sku_id: line.sku_id 
          });
          if (stock.length > 0) {
            await base44.entities.CurrentStock.update(stock[0].id, {
              quantity_available: (stock[0].quantity_available || 0) + line.quantity
            });
          }
        }
      }
      
      // Delete lines
      const lines = orderLines.filter(l => l.order_id === order.id);
      for (const line of lines) {
        await base44.entities.OrderLine.delete(line.id);
      }
      await base44.entities.Order.delete(order.id);
    }

    await base44.entities.ImportBatch.delete(deleteBatch.id);
    setDeleteBatch(null);
    loadData();
    toast({ title: 'Batch deleted and stock restored' });
  };

  const handleCSVUpload = async (file) => {
    setProcessing(true);
    
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    
    const result = await base44.integrations.Core.ExtractDataFromUploadedFile({
      file_url,
      json_schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            amazon_order_id: { type: 'string' },
            order_date: { type: 'string' },
            sku_code: { type: 'string' },
            quantity: { type: 'number' }
          }
        }
      }
    });

    const batch = await base44.entities.ImportBatch.create({
      tenant_id: tenantId,
      batch_type: 'orders',
      batch_name: `Orders Batch - ${format(new Date(), 'yyyy-MM-dd HH:mm')}`,
      filename: file.name,
      status: 'processing',
      total_rows: 0
    });

    const rows = result.output || [];
    let successCount = 0;
    let failedCount = 0;
    const errors = [];
    const orderMap = {};

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      
      if (!row.amazon_order_id || !row.sku_code) {
        failedCount++;
        errors.push({
          row_number: i + 1,
          raw_row_json: JSON.stringify(row),
          error_reason: 'Missing required fields'
        });
        continue;
      }

      const sku = skus.find(s => s.sku_code === row.sku_code);
      if (!sku) {
        failedCount++;
        errors.push({
          row_number: i + 1,
          raw_row_json: JSON.stringify(row),
          error_reason: `SKU not found: ${row.sku_code}`
        });
        continue;
      }

      // Get or create order
      if (!orderMap[row.amazon_order_id]) {
        const existing = orders.find(o => o.amazon_order_id === row.amazon_order_id);
        if (existing) {
          failedCount++;
          errors.push({
            row_number: i + 1,
            raw_row_json: JSON.stringify(row),
            error_reason: `Duplicate order ID: ${row.amazon_order_id}`
          });
          continue;
        }

        const order = await base44.entities.Order.create({
          tenant_id: tenantId,
          amazon_order_id: row.amazon_order_id,
          order_date: row.order_date || format(new Date(), 'yyyy-MM-dd'),
          status: 'pending',
          import_batch_id: batch.id
        });
        orderMap[row.amazon_order_id] = order;
      }

      await base44.entities.OrderLine.create({
        tenant_id: tenantId,
        order_id: orderMap[row.amazon_order_id].id,
        sku_id: sku.id,
        sku_code: sku.sku_code,
        quantity: parseInt(row.quantity) || 1
      });
      successCount++;
    }

    for (const error of errors) {
      await base44.entities.ImportError.create({
        tenant_id: tenantId,
        batch_id: batch.id,
        ...error
      });
    }

    const status = failedCount === 0 ? 'success' : 
                   successCount === 0 ? 'failed' : 'partial';

    await base44.entities.ImportBatch.update(batch.id, {
      status,
      total_rows: rows.length,
      success_rows: successCount,
      failed_rows: failedCount
    });

    setUploadResult({
      status,
      total_rows: rows.length,
      success_rows: successCount,
      failed_rows: failedCount
    });

    setProcessing(false);
    loadData();
  };

  const addLine = () => {
    setFormData({
      ...formData,
      lines: [...formData.lines, { sku_id: '', quantity: 1 }]
    });
  };

  const updateLine = (index, field, value) => {
    const newLines = [...formData.lines];
    newLines[index][field] = value;
    setFormData({ ...formData, lines: newLines });
  };

  const removeLine = (index) => {
    setFormData({
      ...formData,
      lines: formData.lines.filter((_, i) => i !== index)
    });
  };

  const filteredOrders = orders.filter(order => {
    const matchesSearch = order.amazon_order_id?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
    const matchesBatch = batchFilter === 'all' || order.import_batch_id === batchFilter;
    return matchesSearch && matchesStatus && matchesBatch;
  });

  const columns = [
    { 
      key: 'amazon_order_id', 
      header: 'Order ID', 
      sortable: true,
      render: (val) => <span className="font-medium text-slate-900">{val}</span>
    },
    { 
      key: 'order_date', 
      header: 'Date', 
      sortable: true,
      render: (val) => val ? format(new Date(val), 'MMM d, yyyy') : '-'
    },
    { 
      key: 'status', 
      header: 'Status',
      render: (val) => <StatusBadge status={val} />
    },
    { 
      key: 'net_revenue', 
      header: 'Revenue', 
      align: 'right',
      render: (val) => val ? `$${val.toFixed(2)}` : '-'
    },
    { 
      key: 'total_cost', 
      header: 'Cost', 
      align: 'right',
      render: (val) => val ? `$${val.toFixed(2)}` : '-'
    },
    { 
      key: 'profit_loss', 
      header: 'Profit', 
      align: 'right',
      render: (val) => val !== null ? (
        <span className={val >= 0 ? 'text-emerald-600' : 'text-red-600'}>
          ${val.toFixed(2)}
        </span>
      ) : '-'
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (_, row) => (
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="icon" onClick={() => setShowDetails(row)}>
            <Eye className="w-4 h-4" />
          </Button>
          {row.status === 'pending' && (
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => handleFulfillOrder(row)}
              className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
            >
              <Play className="w-4 h-4" />
            </Button>
          )}
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => handleDeleteOrder(row)}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      )
    }
  ];

  const csvTemplate = 'data:text/csv;charset=utf-8,amazon_order_id,order_date,sku_code,quantity\n111-1234567-1234567,2024-01-15,SKU001,2';

  return (
    <div className="space-y-6">
      <PaywallBanner subscription={subscription} onUpgrade={() => {}} />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Orders</h1>
          <p className="text-slate-500">Manage Amazon orders and fulfillment</p>
        </div>
        <Button 
          onClick={() => setShowForm(true)}
          className="bg-indigo-600 hover:bg-indigo-700"
          disabled={!isActive}
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Order
        </Button>
      </div>

      <Tabs defaultValue="list" className="space-y-6">
        <TabsList>
          <TabsTrigger value="list">Orders List</TabsTrigger>
          <TabsTrigger value="import">Import CSV</TabsTrigger>
          <TabsTrigger value="batches">Batch History</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-6">
          <div className="flex flex-wrap gap-4">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search orders..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="fulfilled">Fulfilled</SelectItem>
                <SelectItem value="partially_returned">Partial Return</SelectItem>
                <SelectItem value="fully_returned">Full Return</SelectItem>
              </SelectContent>
            </Select>
            <Select value={batchFilter} onValueChange={setBatchFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Batch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Batches</SelectItem>
                {batches.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.batch_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DataTable
            columns={columns}
            data={filteredOrders}
            loading={loading}
            emptyIcon={ShoppingCart}
            emptyTitle="No orders yet"
            emptyDescription="Import orders or add them manually"
            emptyAction="Add Order"
            onEmptyAction={() => setShowForm(true)}
          />
        </TabsContent>

        <TabsContent value="import" className="space-y-4">
          <UploadRequirementsBanner 
            columns={[
              { name: 'amazon_order_id', required: true },
              { name: 'order_date', required: true },
              { name: 'sku_code', required: true },
              { name: 'quantity', required: true }
            ]}
          />
          <CSVUploader
            title="Import Orders"
            description="Upload a CSV file to bulk import orders"
            templateUrl={csvTemplate}
            templateName="orders_template.csv"
            onUpload={handleCSVUpload}
            processing={processing}
            result={uploadResult}
            onReset={() => setUploadResult(null)}
          />
        </TabsContent>

        <TabsContent value="batches">
          <BatchHistory
            batches={batches}
            loading={loading}
            onDelete={(batch) => setDeleteBatch(batch)}
          />
        </TabsContent>
      </Tabs>

      {/* Add Order Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Order</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Amazon Order ID *</Label>
                <Input
                  value={formData.amazon_order_id}
                  onChange={(e) => setFormData({...formData, amazon_order_id: e.target.value})}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Order Date *</Label>
                <Input
                  type="date"
                  value={formData.order_date}
                  onChange={(e) => setFormData({...formData, order_date: e.target.value})}
                  required
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Order Lines</Label>
                <Button type="button" variant="outline" size="sm" onClick={addLine}>
                  <Plus className="w-4 h-4 mr-1" /> Add Line
                </Button>
              </div>
              {formData.lines.map((line, i) => (
                <div key={i} className="flex gap-2">
                  <Select
                    value={line.sku_id}
                    onValueChange={(val) => updateLine(i, 'sku_id', val)}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select SKU" />
                    </SelectTrigger>
                    <SelectContent>
                      {skus.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.sku_code} - {s.product_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min="1"
                    value={line.quantity}
                    onChange={(e) => updateLine(i, 'quantity', e.target.value)}
                    className="w-20"
                  />
                  {formData.lines.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(i)}>
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700">
                Create Order
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Order Details Dialog */}
      <Dialog open={!!showDetails} onOpenChange={() => setShowDetails(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Order Details</DialogTitle>
          </DialogHeader>
          {showDetails && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-slate-500">Order ID</p>
                  <p className="font-medium">{showDetails.amazon_order_id}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">Date</p>
                  <p className="font-medium">{showDetails.order_date ? format(new Date(showDetails.order_date), 'MMM d, yyyy') : '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">Status</p>
                  <StatusBadge status={showDetails.status} />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Revenue</p>
                  <p className="font-medium">${(showDetails.net_revenue || 0).toFixed(2)}</p>
                </div>
              </div>

              <div>
                <p className="text-sm text-slate-500 mb-2">Order Lines</p>
                <div className="space-y-2">
                  {orderLines.filter(l => l.order_id === showDetails.id).map(line => (
                    <div key={line.id} className="flex justify-between p-3 bg-slate-50 rounded-lg">
                      <div>
                        <p className="font-medium">{line.sku_code}</p>
                        <p className="text-sm text-slate-500">Qty: {line.quantity}</p>
                      </div>
                      <div className="text-right">
                        {line.line_total_cost && (
                          <p className="font-medium">${line.line_total_cost.toFixed(2)}</p>
                        )}
                        {line.is_returned && (
                          <StatusBadge status="fully_returned" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Batch Confirmation */}
      <AlertDialog open={!!deleteBatch} onOpenChange={() => setDeleteBatch(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Batch?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete all orders in this batch and reverse any stock movements. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteBatch} className="bg-red-600 hover:bg-red-700">
              Delete Batch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}