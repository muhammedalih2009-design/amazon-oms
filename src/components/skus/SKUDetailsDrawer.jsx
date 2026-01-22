import React, { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTenant } from '@/components/hooks/useTenant';
import StockMovementHistory from './StockMovementHistory';

export default function SKUDetailsDrawer({ open, onClose, sku, suppliers, currentStock, onUpdate }) {
  const { tenantId, isOwner, isAdmin } = useTenant();
  const [formData, setFormData] = useState({
    product_name: '',
    cost_price: '',
    supplier_id: '',
    image_url: ''
  });

  useEffect(() => {
    if (sku) {
      setFormData({
        product_name: sku.product_name,
        cost_price: sku.cost_price.toString(),
        supplier_id: sku.supplier_id || '',
        image_url: sku.image_url || ''
      });
    }
  }, [sku]);

  if (!sku) return null;

  const stock = currentStock.find(s => s.sku_id === sku.id);
  const stockQty = stock?.quantity_available || 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    await onUpdate(sku.id, {
      product_name: formData.product_name,
      cost_price: parseFloat(formData.cost_price),
      supplier_id: formData.supplier_id || null,
      image_url: formData.image_url || null
    });
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="sm:max-w-[600px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>SKU Details</SheetTitle>
        </SheetHeader>

        <Tabs defaultValue="details" className="py-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="history">Movement History</TabsTrigger>
          </TabsList>

          <TabsContent value="details">
            <form onSubmit={handleSubmit} className="space-y-6">
          {/* Image Preview */}
          {formData.image_url && (
            <div className="flex justify-center">
              <img
                src={formData.image_url}
                alt={sku.product_name}
                className="w-32 h-32 object-cover rounded-xl border border-slate-200"
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
            </div>
          )}

          <div>
            <Label>SKU Code</Label>
            <Input value={sku.sku_code} disabled className="bg-slate-50" />
          </div>

          <div>
            <Label htmlFor="product_name">Product Name *</Label>
            <Input
              id="product_name"
              value={formData.product_name}
              onChange={(e) => setFormData({ ...formData, product_name: e.target.value })}
              required
            />
          </div>

          <div>
            <Label htmlFor="cost_price">Cost *</Label>
            <Input
              id="cost_price"
              type="number"
              step="0.01"
              min="0.01"
              value={formData.cost_price}
              onChange={(e) => setFormData({ ...formData, cost_price: e.target.value })}
              required
            />
          </div>

          <div>
            <Label>Supplier</Label>
            <Select
              value={formData.supplier_id}
              onValueChange={(value) => setFormData({ ...formData, supplier_id: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select supplier" />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>
                    {supplier.supplier_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="image_url">Image URL</Label>
            <Input
              id="image_url"
              value={formData.image_url}
              onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
              placeholder="https://..."
            />
          </div>

          <div>
            <Label>Current Stock</Label>
            <Input 
              value={stockQty} 
              disabled 
              className="bg-slate-50 font-semibold"
            />
            <p className="text-xs text-slate-500 mt-1">
              Stock is managed through purchases and orders
            </p>
          </div>

              <SheetFooter className="gap-2 mt-6">
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit">Save Changes</Button>
              </SheetFooter>
            </form>
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            {sku && (
              <StockMovementHistory 
                sku={sku} 
                tenantId={tenantId} 
                currentStock={currentStock}
                isOwner={isOwner}
                isAdmin={isAdmin}
              />
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}