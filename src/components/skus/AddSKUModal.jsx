import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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
import { Plus } from 'lucide-react';

export default function AddSKUModal({ open, onClose, onSubmit, suppliers, tenantId }) {
  const [formData, setFormData] = useState({
    sku_code: '',
    product_name: '',
    cost_price: '',
    supplier_id: '',
    image_url: ''
  });

  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    let supplier_id = formData.supplier_id;
    
    // Create supplier if needed
    if (showAddSupplier && newSupplierName) {
      const newSupplier = await onSubmit.createSupplier({
        tenant_id: tenantId,
        supplier_name: newSupplierName
      });
      supplier_id = newSupplier.id;
    }

    await onSubmit.createSKU({
      tenant_id: tenantId,
      sku_code: formData.sku_code,
      product_name: formData.product_name,
      cost_price: parseFloat(formData.cost_price),
      supplier_id: supplier_id || null,
      image_url: formData.image_url || null
    });

    // Reset form
    setFormData({
      sku_code: '',
      product_name: '',
      cost_price: '',
      supplier_id: '',
      image_url: ''
    });
    setShowAddSupplier(false);
    setNewSupplierName('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add New SKU</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="sku_code">SKU Code *</Label>
              <Input
                id="sku_code"
                value={formData.sku_code}
                onChange={(e) => setFormData({ ...formData, sku_code: e.target.value })}
                placeholder="WGT-001"
                required
              />
            </div>

            <div>
              <Label htmlFor="product_name">Product Name *</Label>
              <Input
                id="product_name"
                value={formData.product_name}
                onChange={(e) => setFormData({ ...formData, product_name: e.target.value })}
                placeholder="Wireless Earbuds Pro"
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
                placeholder="15.50"
                required
              />
            </div>

            <div>
              <Label>Supplier</Label>
              {!showAddSupplier ? (
                <div className="flex gap-2">
                  <Select
                    value={formData.supplier_id}
                    onValueChange={(value) => setFormData({ ...formData, supplier_id: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select supplier (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.supplier_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setShowAddSupplier(true)}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    value={newSupplierName}
                    onChange={(e) => setNewSupplierName(e.target.value)}
                    placeholder="New supplier name"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowAddSupplier(false);
                      setNewSupplierName('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
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
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save SKU</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}