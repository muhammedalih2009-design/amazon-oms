import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { Users, Plus, Edit, Trash2, Search, Mail, Phone, MapPin } from 'lucide-react';
import RefreshButton from '@/components/shared/RefreshButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import DataTable from '@/components/shared/DataTable';
import PaywallBanner from '@/components/ui/PaywallBanner';
import { useToast } from '@/components/ui/use-toast';

export default function Suppliers() {
  const { tenantId, subscription, isActive } = useTenant();
  const { toast } = useToast();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [formData, setFormData] = useState({
    supplier_name: '',
    email: '',
    phone: '',
    address: '',
    contact_info: ''
  });

  useEffect(() => {
    if (tenantId) loadData();
  }, [tenantId]);

  const loadData = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    const data = await base44.entities.Supplier.filter({ tenant_id: tenantId });
    setSuppliers(data);
    if (isRefresh) {
      setRefreshing(false);
    } else {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const data = {
      ...formData,
      tenant_id: tenantId
    };

    if (editingSupplier) {
      await base44.entities.Supplier.update(editingSupplier.id, data);
      toast({ title: 'Supplier updated' });
    } else {
      await base44.entities.Supplier.create(data);
      toast({ title: 'Supplier created' });
    }

    setShowForm(false);
    setEditingSupplier(null);
    setFormData({ supplier_name: '', email: '', phone: '', address: '', contact_info: '' });
    loadData();
  };

  const handleEdit = (supplier) => {
    setEditingSupplier(supplier);
    setFormData({
      supplier_name: supplier.supplier_name || '',
      email: supplier.email || '',
      phone: supplier.phone || '',
      address: supplier.address || '',
      contact_info: supplier.contact_info || ''
    });
    setShowForm(true);
  };

  const handleDelete = async (supplier) => {
    if (confirm('Are you sure you want to delete this supplier?')) {
      await base44.entities.Supplier.delete(supplier.id);
      toast({ title: 'Supplier deleted' });
      loadData();
    }
  };

  const filteredSuppliers = suppliers.filter(s =>
    s.supplier_name?.toLowerCase().includes(search.toLowerCase()) ||
    s.email?.toLowerCase().includes(search.toLowerCase())
  );

  const columns = [
    {
      key: 'supplier_name',
      header: 'Supplier Name',
      sortable: true,
      render: (val) => <span className="font-medium text-slate-900">{val}</span>
    },
    {
      key: 'email',
      header: 'Email',
      render: (val) => val ? (
        <div className="flex items-center gap-2 text-slate-600">
          <Mail className="w-4 h-4 text-slate-400" />
          {val}
        </div>
      ) : '-'
    },
    {
      key: 'phone',
      header: 'Phone',
      render: (val) => val ? (
        <div className="flex items-center gap-2 text-slate-600">
          <Phone className="w-4 h-4 text-slate-400" />
          {val}
        </div>
      ) : '-'
    },
    {
      key: 'address',
      header: 'Address',
      render: (val) => val ? (
        <div className="flex items-center gap-2 text-slate-600 max-w-xs truncate">
          <MapPin className="w-4 h-4 text-slate-400 flex-shrink-0" />
          {val}
        </div>
      ) : '-'
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (_, row) => (
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="icon" onClick={() => handleEdit(row)}>
            <Edit className="w-4 h-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => handleDelete(row)}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <PaywallBanner subscription={subscription} onUpgrade={() => {}} />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Suppliers</h1>
          <p className="text-slate-500">Manage your vendor contacts</p>
        </div>
        <div className="flex items-center gap-3">
          <RefreshButton onRefresh={() => loadData(true)} loading={refreshing} />
          <Button 
            onClick={() => setShowForm(true)}
            className="bg-indigo-600 hover:bg-indigo-700"
            disabled={!isActive}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Supplier
          </Button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          placeholder="Search suppliers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      <DataTable
        columns={columns}
        data={filteredSuppliers}
        loading={loading}
        emptyIcon={Users}
        emptyTitle="No suppliers yet"
        emptyDescription="Add your first supplier to get started"
        emptyAction="Add Supplier"
        onEmptyAction={() => setShowForm(true)}
      />

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingSupplier ? 'Edit Supplier' : 'Add New Supplier'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="supplier_name">Supplier Name *</Label>
              <Input
                id="supplier_name"
                value={formData.supplier_name}
                onChange={(e) => setFormData({...formData, supplier_name: e.target.value})}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({...formData, phone: e.target.value})}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Textarea
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({...formData, address: e.target.value})}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact_info">Additional Notes</Label>
              <Textarea
                id="contact_info"
                value={formData.contact_info}
                onChange={(e) => setFormData({...formData, contact_info: e.target.value})}
                rows={2}
                placeholder="Payment terms, contact person, etc."
              />
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700">
                {editingSupplier ? 'Update' : 'Create'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}