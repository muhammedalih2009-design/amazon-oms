import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { format } from 'date-fns';
import { Truck, Plus, Search, Edit, Trash2, ShoppingCart } from 'lucide-react';
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
import DataTable from '@/components/shared/DataTable';
import PaywallBanner from '@/components/ui/PaywallBanner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';

export default function Purchases() {
  const { tenantId, subscription, isActive } = useTenant();
  const { toast } = useToast();
  const [purchases, setPurchases] = useState([]);
  const [skus, setSkus] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showCartForm, setShowCartForm] = useState(false);
  const [formData, setFormData] = useState({
    sku_id: '',
    quantity_purchased: '',
    total_cost: '',
    purchase_date: format(new Date(), 'yyyy-MM-dd'),
    supplier_id: ''
  });
  const [cartSupplier, setCartSupplier] = useState('');
  const [cartItems, setCartItems] = useState([]);

  useEffect(() => {
    if (tenantId) loadData();
  }, [tenantId]);

  const loadData = async () => {
    setLoading(true);
    const [purchasesData, skusData, suppliersData, cartData] = await Promise.all([
      base44.entities.Purchase.filter({ tenant_id: tenantId }),
      base44.entities.SKU.filter({ tenant_id: tenantId }),
      base44.entities.Supplier.filter({ tenant_id: tenantId }),
      base44.entities.PurchaseCart.filter({ tenant_id: tenantId })
    ]);
    setPurchases(purchasesData.sort((a, b) => new Date(b.purchase_date) - new Date(a.purchase_date)));
    setSkus(skusData);
    setSuppliers(suppliersData);
    setCart(cartData);
    
    // Initialize cart items
    setCartItems(cartData.map(c => ({
      ...c,
      quantity: c.quantity_needed,
      unit_cost: skus.find(s => s.id === c.sku_id)?.cost_price || 0
    })));
    
    setLoading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const sku = skus.find(s => s.id === formData.sku_id);
    const costPerUnit = parseFloat(formData.total_cost) / parseInt(formData.quantity_purchased);
    
    await base44.entities.Purchase.create({
      tenant_id: tenantId,
      sku_id: formData.sku_id,
      sku_code: sku?.sku_code,
      quantity_purchased: parseInt(formData.quantity_purchased),
      total_cost: parseFloat(formData.total_cost),
      cost_per_unit: costPerUnit,
      purchase_date: formData.purchase_date,
      supplier_id: formData.supplier_id || null,
      supplier_name: suppliers.find(s => s.id === formData.supplier_id)?.supplier_name,
      quantity_remaining: parseInt(formData.quantity_purchased)
    });

    // Update current stock
    const stock = await base44.entities.CurrentStock.filter({ 
      tenant_id: tenantId, 
      sku_id: formData.sku_id 
    });
    
    if (stock.length > 0) {
      await base44.entities.CurrentStock.update(stock[0].id, {
        quantity_available: (stock[0].quantity_available || 0) + parseInt(formData.quantity_purchased)
      });
    } else {
      await base44.entities.CurrentStock.create({
        tenant_id: tenantId,
        sku_id: formData.sku_id,
        sku_code: sku?.sku_code,
        quantity_available: parseInt(formData.quantity_purchased)
      });
    }

    // Create stock movement
    await base44.entities.StockMovement.create({
      tenant_id: tenantId,
      sku_id: formData.sku_id,
      sku_code: sku?.sku_code,
      movement_type: 'purchase',
      quantity: parseInt(formData.quantity_purchased),
      reference_type: 'purchase',
      reference_id: 'new',
      movement_date: formData.purchase_date
    });

    setShowForm(false);
    setFormData({
      sku_id: '',
      quantity_purchased: '',
      total_cost: '',
      purchase_date: format(new Date(), 'yyyy-MM-dd'),
      supplier_id: ''
    });
    loadData();
    toast({ title: 'Purchase recorded successfully' });
  };

  const handleCartPurchase = async () => {
    const validItems = cartItems.filter(item => item.quantity > 0 && item.unit_cost > 0);
    
    if (validItems.length === 0) {
      toast({ title: 'Add quantities and costs', variant: 'destructive' });
      return;
    }

    for (const item of validItems) {
      const totalCost = item.quantity * item.unit_cost;
      
      await base44.entities.Purchase.create({
        tenant_id: tenantId,
        sku_id: item.sku_id,
        sku_code: item.sku_code,
        quantity_purchased: item.quantity,
        total_cost: totalCost,
        cost_per_unit: item.unit_cost,
        purchase_date: format(new Date(), 'yyyy-MM-dd'),
        supplier_id: cartSupplier || null,
        supplier_name: suppliers.find(s => s.id === cartSupplier)?.supplier_name,
        quantity_remaining: item.quantity
      });

      // Update current stock
      const stock = await base44.entities.CurrentStock.filter({ 
        tenant_id: tenantId, 
        sku_id: item.sku_id 
      });
      
      if (stock.length > 0) {
        await base44.entities.CurrentStock.update(stock[0].id, {
          quantity_available: (stock[0].quantity_available || 0) + item.quantity
        });
      } else {
        await base44.entities.CurrentStock.create({
          tenant_id: tenantId,
          sku_id: item.sku_id,
          sku_code: item.sku_code,
          quantity_available: item.quantity
        });
      }

      // Create stock movement
      await base44.entities.StockMovement.create({
        tenant_id: tenantId,
        sku_id: item.sku_id,
        sku_code: item.sku_code,
        movement_type: 'purchase',
        quantity: item.quantity,
        reference_type: 'purchase',
        reference_id: 'cart',
        movement_date: format(new Date(), 'yyyy-MM-dd')
      });
    }

    // Clear cart
    for (const item of cart) {
      await base44.entities.PurchaseCart.delete(item.id);
    }

    setShowCartForm(false);
    loadData();
    toast({ title: 'Purchases recorded and stock updated' });
  };

  const handleDelete = async (purchase) => {
    if (confirm('Delete this purchase? This will not reverse stock changes.')) {
      await base44.entities.Purchase.delete(purchase.id);
      loadData();
    }
  };

  const updateCartItem = (index, field, value) => {
    const newItems = [...cartItems];
    newItems[index][field] = parseFloat(value) || 0;
    setCartItems(newItems);
  };

  const clearCart = async () => {
    for (const item of cart) {
      await base44.entities.PurchaseCart.delete(item.id);
    }
    loadData();
    toast({ title: 'Cart cleared' });
  };

  const filteredPurchases = purchases.filter(p =>
    p.sku_code?.toLowerCase().includes(search.toLowerCase()) ||
    p.supplier_name?.toLowerCase().includes(search.toLowerCase())
  );

  const columns = [
    {
      key: 'purchase_date',
      header: 'Date',
      sortable: true,
      render: (val) => format(new Date(val), 'MMM d, yyyy')
    },
    {
      key: 'sku_code',
      header: 'SKU',
      sortable: true,
      render: (val) => <span className="font-medium text-slate-900">{val}</span>
    },
    {
      key: 'supplier_name',
      header: 'Supplier',
      render: (val) => val || '-'
    },
    {
      key: 'quantity_purchased',
      header: 'Qty',
      align: 'right'
    },
    {
      key: 'cost_per_unit',
      header: 'Unit Cost',
      align: 'right',
      render: (val) => `$${(val || 0).toFixed(2)}`
    },
    {
      key: 'total_cost',
      header: 'Total',
      align: 'right',
      render: (val) => <span className="font-medium">${(val || 0).toFixed(2)}</span>
    },
    {
      key: 'quantity_remaining',
      header: 'Remaining',
      align: 'right',
      render: (val) => (
        <span className={val > 0 ? 'text-emerald-600' : 'text-slate-400'}>{val || 0}</span>
      )
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (_, row) => (
        <Button 
          variant="ghost" 
          size="icon"
          onClick={() => handleDelete(row)}
          className="text-red-600 hover:text-red-700 hover:bg-red-50"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      )
    }
  ];

  const cartTotal = cartItems.reduce((sum, item) => sum + (item.quantity * item.unit_cost), 0);

  return (
    <div className="space-y-6">
      <PaywallBanner subscription={subscription} onUpgrade={() => {}} />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Purchases</h1>
          <p className="text-slate-500">Record inventory purchases</p>
        </div>
        <div className="flex gap-3">
          {cart.length > 0 && (
            <Button 
              onClick={() => setShowCartForm(true)}
              variant="outline"
              className="border-indigo-200 text-indigo-600"
            >
              <ShoppingCart className="w-4 h-4 mr-2" />
              Cart ({cart.length})
            </Button>
          )}
          <Button 
            onClick={() => setShowForm(true)}
            className="bg-indigo-600 hover:bg-indigo-700"
            disabled={!isActive}
          >
            <Plus className="w-4 h-4 mr-2" />
            Record Purchase
          </Button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          placeholder="Search purchases..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      <DataTable
        columns={columns}
        data={filteredPurchases}
        loading={loading}
        emptyIcon={Truck}
        emptyTitle="No purchases yet"
        emptyDescription="Record your first inventory purchase"
        emptyAction="Record Purchase"
        onEmptyAction={() => setShowForm(true)}
      />

      {/* Add Purchase Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record Purchase</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>SKU *</Label>
              <Select
                value={formData.sku_id}
                onValueChange={(val) => setFormData({...formData, sku_id: val})}
              >
                <SelectTrigger>
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
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Quantity *</Label>
                <Input
                  type="number"
                  min="1"
                  value={formData.quantity_purchased}
                  onChange={(e) => setFormData({...formData, quantity_purchased: e.target.value})}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Total Cost *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.total_cost}
                  onChange={(e) => setFormData({...formData, total_cost: e.target.value})}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Purchase Date *</Label>
                <Input
                  type="date"
                  value={formData.purchase_date}
                  onChange={(e) => setFormData({...formData, purchase_date: e.target.value})}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Supplier</Label>
                <Select
                  value={formData.supplier_id}
                  onValueChange={(val) => setFormData({...formData, supplier_id: val})}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.supplier_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {formData.quantity_purchased && formData.total_cost && (
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-sm text-slate-500">
                  Cost per unit: <span className="font-semibold text-slate-900">
                    ${(parseFloat(formData.total_cost) / parseInt(formData.quantity_purchased)).toFixed(2)}
                  </span>
                </p>
              </div>
            )}
            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700">
                Record Purchase
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Cart Purchase Dialog */}
      <Dialog open={showCartForm} onOpenChange={setShowCartForm}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Complete Purchase from Cart</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Supplier</Label>
              <Select value={cartSupplier} onValueChange={setCartSupplier}>
                <SelectTrigger>
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.supplier_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="border rounded-xl overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500">SKU</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500">Product</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500">Quantity</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500">Unit Cost</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {cartItems.map((item, i) => (
                    <tr key={item.id} className="border-t">
                      <td className="py-3 px-4 font-medium">{item.sku_code}</td>
                      <td className="py-3 px-4 text-slate-600">{item.product_name}</td>
                      <td className="py-3 px-4">
                        <Input
                          type="number"
                          min="0"
                          value={item.quantity}
                          onChange={(e) => updateCartItem(i, 'quantity', e.target.value)}
                          className="w-20 text-right ml-auto"
                        />
                      </td>
                      <td className="py-3 px-4">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.unit_cost}
                          onChange={(e) => updateCartItem(i, 'unit_cost', e.target.value)}
                          className="w-24 text-right ml-auto"
                        />
                      </td>
                      <td className="py-3 px-4 text-right font-medium">
                        ${(item.quantity * item.unit_cost).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50">
                  <tr>
                    <td colSpan="4" className="py-3 px-4 text-right font-semibold">Total:</td>
                    <td className="py-3 px-4 text-right font-bold text-lg">${cartTotal.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex justify-between pt-4">
              <Button type="button" variant="outline" onClick={clearCart}>
                Clear Cart
              </Button>
              <div className="flex gap-3">
                <Button type="button" variant="outline" onClick={() => setShowCartForm(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCartPurchase} className="bg-indigo-600 hover:bg-indigo-700">
                  Complete Purchase
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}