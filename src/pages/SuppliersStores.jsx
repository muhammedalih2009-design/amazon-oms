import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { useLanguage } from '@/components/contexts/LanguageContext';
import { Users, Store, Plus, Edit, Trash2, Search, Mail, Phone, MapPin, RefreshCw } from 'lucide-react';
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
import PaywallBanner from '@/components/ui/PaywallBanner';
import PremiumCollapsibleSection from '@/components/shared/PremiumCollapsibleSection';
import { useToast } from '@/components/ui/use-toast';

export default function SuppliersStores() {
  const { tenantId, tenant, subscription, isActive, isModuleEnabled } = useTenant();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();

  // Stores state
  const [stores, setStores] = useState([]);
  const [orders, setOrders] = useState([]);
  const [storesLoading, setStoresLoading] = useState(false);
  const [storesLoaded, setStoresLoaded] = useState(false);
  const [storesRefreshing, setStoresRefreshing] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [showStoreForm, setShowStoreForm] = useState(false);
  const [editingStore, setEditingStore] = useState(null);
  const [deleteStore, setDeleteStore] = useState(null);
  const [storeFormData, setStoreFormData] = useState({
    name: '',
    platform: 'Amazon',
    color: '#6366f1'
  });

  // Suppliers state
  const [suppliers, setSuppliers] = useState([]);
  const [suppliersLoading, setSuppliersLoading] = useState(false);
  const [suppliersLoaded, setSuppliersLoaded] = useState(false);
  const [suppliersRefreshing, setSuppliersRefreshing] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [supplierFormData, setSupplierFormData] = useState({
    supplier_name: '',
    email: '',
    phone: '',
    address: '',
    contact_info: ''
  });

  const platformColors = {
    Amazon: '#FF9900',
    Noon: '#FED530',
    Jumia: '#F47920',
    Other: '#6366f1'
  };

  // Check module access
  const storesEnabled = isModuleEnabled('stores');
  const suppliersEnabled = isModuleEnabled('suppliers');

  // Handle deep linking via query params
  useEffect(() => {
    const openParam = searchParams.get('open');
    if (openParam === 'stores' && storesEnabled) {
      loadStoresData();
    } else if (openParam === 'suppliers' && suppliersEnabled) {
      loadSuppliersData();
    }
  }, [searchParams]);

  // Load stores data
  const loadStoresData = async () => {
    if (storesLoaded) return;
    
    setStoresLoading(true);
    try {
      const [storesData, ordersData] = await Promise.all([
        base44.entities.Store.filter({ tenant_id: tenantId }),
        base44.entities.Order.filter({ tenant_id: tenantId })
      ]);
      setStores(storesData);
      setOrders(ordersData);
      setStoresLoaded(true);
    } catch (error) {
      toast({ title: 'Error loading stores', description: error.message, variant: 'destructive' });
    } finally {
      setStoresLoading(false);
    }
  };

  const refreshStores = async () => {
    setStoresRefreshing(true);
    try {
      const [storesData, ordersData] = await Promise.all([
        base44.entities.Store.filter({ tenant_id: tenantId }),
        base44.entities.Order.filter({ tenant_id: tenantId })
      ]);
      setStores(storesData);
      setOrders(ordersData);
    } catch (error) {
      toast({ title: 'Error refreshing stores', description: error.message, variant: 'destructive' });
    } finally {
      setStoresRefreshing(false);
    }
  };

  // Load suppliers data
  const loadSuppliersData = async () => {
    if (suppliersLoaded) return;
    
    setSuppliersLoading(true);
    try {
      const data = await base44.entities.Supplier.filter({ tenant_id: tenantId });
      setSuppliers(data);
      setSuppliersLoaded(true);
    } catch (error) {
      toast({ title: 'Error loading suppliers', description: error.message, variant: 'destructive' });
    } finally {
      setSuppliersLoading(false);
    }
  };

  const refreshSuppliers = async () => {
    setSuppliersRefreshing(true);
    try {
      const data = await base44.entities.Supplier.filter({ tenant_id: tenantId });
      setSuppliers(data);
    } catch (error) {
      toast({ title: 'Error refreshing suppliers', description: error.message, variant: 'destructive' });
    } finally {
      setSuppliersRefreshing(false);
    }
  };

  // Store handlers
  const handleStoreSubmit = async (e) => {
    e.preventDefault();
    
    try {
      if (editingStore) {
        await base44.entities.Store.update(editingStore.id, storeFormData);
        toast({ title: 'Store updated successfully' });
      } else {
        await base44.entities.Store.create({
          tenant_id: tenantId,
          ...storeFormData
        });
        toast({ title: 'Store created successfully' });
      }

      setShowStoreForm(false);
      setEditingStore(null);
      setStoreFormData({ name: '', platform: 'Amazon', color: '#6366f1' });
      refreshStores();
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleStoreEdit = (store) => {
    setEditingStore(store);
    setStoreFormData({
      name: store.name,
      platform: store.platform,
      color: store.color || platformColors[store.platform]
    });
    setShowStoreForm(true);
  };

  const handleStoreDelete = async () => {
    if (!deleteStore) return;
    
    const storeOrders = orders.filter(o => o.store_id === deleteStore.id);
    if (storeOrders.length > 0) {
      toast({
        title: 'Cannot delete store',
        description: `This store has ${storeOrders.length} orders. Please delete or reassign them first.`,
        variant: 'destructive'
      });
      setDeleteStore(null);
      return;
    }

    try {
      await base44.entities.Store.delete(deleteStore.id);
      setDeleteStore(null);
      refreshStores();
      toast({ title: 'Store deleted successfully' });
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleRecompute = async () => {
    setRecomputing(true);
    try {
      const response = await base44.functions.invoke('recomputeWorkspace', {
        workspaceId: tenantId
      });
      
      toast({
        title: '✓ Workspace recomputed',
        description: `${response.data.results.orders_recomputed} orders updated`
      });
      
      await refreshStores();
    } catch (error) {
      toast({
        title: 'Recompute failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setRecomputing(false);
    }
  };

  // Supplier handlers
  const handleSupplierSubmit = async (e) => {
    e.preventDefault();
    
    try {
      const data = { ...supplierFormData, tenant_id: tenantId };

      if (editingSupplier) {
        await base44.entities.Supplier.update(editingSupplier.id, data);
        toast({ title: 'Supplier updated' });
      } else {
        await base44.entities.Supplier.create(data);
        toast({ title: 'Supplier created' });
      }

      setShowSupplierForm(false);
      setEditingSupplier(null);
      setSupplierFormData({ supplier_name: '', email: '', phone: '', address: '', contact_info: '' });
      refreshSuppliers();
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleSupplierEdit = (supplier) => {
    setEditingSupplier(supplier);
    setSupplierFormData({
      supplier_name: supplier.supplier_name || '',
      email: supplier.email || '',
      phone: supplier.phone || '',
      address: supplier.address || '',
      contact_info: supplier.contact_info || ''
    });
    setShowSupplierForm(true);
  };

  const handleSupplierDelete = async (supplier) => {
    if (confirm('Are you sure you want to delete this supplier?')) {
      try {
        await base44.entities.Supplier.delete(supplier.id);
        toast({ title: 'Supplier deleted' });
        refreshSuppliers();
      } catch (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
      }
    }
  };

  // Get store stats
  const getStoreStats = (storeId) => {
    const storeOrders = orders.filter(o => o.store_id === storeId);
    const totalRevenue = storeOrders.reduce((sum, o) => sum + (o.net_revenue || 0), 0);
    const totalProfit = storeOrders.reduce((sum, o) => sum + (o.profit_loss || 0), 0);
    const fulfilledCount = storeOrders.filter(o => o.status === 'fulfilled').length;
    
    return {
      totalOrders: storeOrders.length,
      totalRevenue,
      totalProfit,
      fulfilledCount
    };
  };

  // Filtered suppliers
  const filteredSuppliers = suppliers.filter(s =>
    s.supplier_name?.toLowerCase().includes(supplierSearch.toLowerCase()) ||
    s.email?.toLowerCase().includes(supplierSearch.toLowerCase())
  );

  // Store columns
  const storeColumns = [
    {
      key: 'name',
      header: 'Store Name',
      render: (val, row) => (
        <div className="flex items-center gap-3">
          <div 
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: row.color || platformColors[row.platform] }}
          />
          <span className="font-medium text-slate-900">{val}</span>
        </div>
      )
    },
    {
      key: 'platform',
      header: 'Platform',
      render: (val) => (
        <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-sm">
          {val}
        </span>
      )
    },
    {
      key: 'stats',
      header: 'Orders',
      render: (_, row) => {
        const stats = getStoreStats(row.id);
        return (
          <span className="text-slate-600">
            {stats.totalOrders} ({stats.fulfilledCount} fulfilled)
          </span>
        );
      }
    },
    {
      key: 'revenue',
      header: 'Revenue',
      align: 'right',
      render: (_, row) => {
        const stats = getStoreStats(row.id);
        return <span className="font-medium">${stats.totalRevenue.toFixed(2)}</span>;
      }
    },
    {
      key: 'profit',
      header: 'Profit',
      align: 'right',
      render: (_, row) => {
        const stats = getStoreStats(row.id);
        return (
          <span className={stats.totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}>
            ${stats.totalProfit.toFixed(2)}
          </span>
        );
      }
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (_, row) => (
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="icon" onClick={() => handleStoreEdit(row)}>
            <Edit className="w-4 h-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setDeleteStore(row)}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      )
    }
  ];

  // Supplier columns
  const supplierColumns = [
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
          <Button variant="ghost" size="icon" onClick={() => handleSupplierEdit(row)}>
            <Edit className="w-4 h-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => handleSupplierDelete(row)}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      )
    }
  ];

  // Show message if both modules are disabled
  if (!storesEnabled && !suppliersEnabled) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Access Restricted</h2>
          <p className="text-slate-600">This feature is not enabled for your workspace.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PaywallBanner subscription={subscription} onUpgrade={() => {}} />

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Suppliers & Stores</h1>
        <p className="text-slate-500">Manage suppliers and sales channels</p>
      </div>

      {/* Stores Section */}
      {storesEnabled && (
        <PremiumCollapsibleSection
          id="stores_sales_channels"
          icon={Store}
          title="Stores & Sales Channels"
          subtitle="Manage stores and integrations"
          defaultOpen={searchParams.get('open') === 'stores'}
          workspaceId={tenantId}
          onOpen={loadStoresData}
          headerActions={[
            {
              label: t('add_store') || 'Add Store',
              icon: Plus,
              variant: 'default',
              className: 'bg-indigo-600 hover:bg-indigo-700 text-white',
              onClick: () => {
                setEditingStore(null);
                setStoreFormData({ name: '', platform: 'Amazon', color: '#6366f1' });
                setShowStoreForm(true);
              }
            }
          ]}
        >
          <div className="space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={handleRecompute}
                  disabled={recomputing}
                  title="Recompute all store stats, order costs, and profitability"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${recomputing ? 'animate-spin' : ''}`} />
                  {recomputing ? 'Recomputing...' : 'Recompute'}
                </Button>
                <RefreshButton onRefresh={refreshStores} loading={storesRefreshing} />
              </div>
            </div>

            <DataTable
              columns={storeColumns}
              data={stores}
              loading={storesLoading}
              emptyIcon={Store}
              emptyTitle="No stores yet"
              emptyDescription="Add your first store to start tracking orders by channel"
              emptyAction="Add Store"
              onEmptyAction={() => setShowStoreForm(true)}
            />
          </div>
        </PremiumCollapsibleSection>
      )}

      {/* Suppliers Section */}
      {suppliersEnabled && (
        <PremiumCollapsibleSection
          id="suppliers_management"
          icon={Users}
          title={t('suppliers') || 'Suppliers'}
          subtitle="Manage your vendor contacts"
          defaultOpen={searchParams.get('open') === 'suppliers'}
          workspaceId={tenantId}
          onOpen={loadSuppliersData}
          headerActions={[
            {
              label: 'Add Supplier',
              icon: Plus,
              variant: 'default',
              className: 'bg-indigo-600 hover:bg-indigo-700 text-white',
              onClick: () => setShowSupplierForm(true)
            }
          ]}
        >
          <div className="space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="relative max-w-md flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search suppliers..."
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              <RefreshButton onRefresh={refreshSuppliers} loading={suppliersRefreshing} />
            </div>

            <DataTable
              columns={supplierColumns}
              data={filteredSuppliers}
              loading={suppliersLoading}
              emptyIcon={Users}
              emptyTitle="No suppliers yet"
              emptyDescription="Add your first supplier to get started"
              emptyAction="Add Supplier"
              onEmptyAction={() => setShowSupplierForm(true)}
            />
          </div>
        </PremiumCollapsibleSection>
      )}

      {/* Store Form Dialog */}
      <Dialog open={showStoreForm} onOpenChange={setShowStoreForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingStore ? 'Edit Store' : 'Add New Store'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleStoreSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Store Name *</Label>
              <Input
                value={storeFormData.name}
                onChange={(e) => setStoreFormData({...storeFormData, name: e.target.value})}
                placeholder="e.g., Arexol, Homera"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Platform *</Label>
              <Select 
                value={storeFormData.platform} 
                onValueChange={(val) => setStoreFormData({
                  ...storeFormData, 
                  platform: val,
                  color: platformColors[val]
                })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Amazon">Amazon</SelectItem>
                  <SelectItem value="Noon">Noon</SelectItem>
                  <SelectItem value="Jumia">Jumia</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Brand Color</Label>
              <div className="flex items-center gap-3">
                <Input
                  type="color"
                  value={storeFormData.color}
                  onChange={(e) => setStoreFormData({...storeFormData, color: e.target.value})}
                  className="w-20 h-10"
                />
                <span className="text-sm text-slate-500">{storeFormData.color}</span>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => {
                setShowStoreForm(false);
                setEditingStore(null);
              }}>
                Cancel
              </Button>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700">
                {editingStore ? 'Update Store' : 'Create Store'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Supplier Form Dialog */}
      <Dialog open={showSupplierForm} onOpenChange={setShowSupplierForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingSupplier ? 'Edit Supplier' : 'Add New Supplier'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSupplierSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="supplier_name">Supplier Name *</Label>
              <Input
                id="supplier_name"
                value={supplierFormData.supplier_name}
                onChange={(e) => setSupplierFormData({...supplierFormData, supplier_name: e.target.value})}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={supplierFormData.email}
                  onChange={(e) => setSupplierFormData({...supplierFormData, email: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={supplierFormData.phone}
                  onChange={(e) => setSupplierFormData({...supplierFormData, phone: e.target.value})}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Textarea
                id="address"
                value={supplierFormData.address}
                onChange={(e) => setSupplierFormData({...supplierFormData, address: e.target.value})}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact_info">Additional Notes</Label>
              <Textarea
                id="contact_info"
                value={supplierFormData.contact_info}
                onChange={(e) => setSupplierFormData({...supplierFormData, contact_info: e.target.value})}
                rows={2}
                placeholder="Payment terms, contact person, etc."
              />
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => setShowSupplierForm(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700">
                {editingSupplier ? 'Update' : 'Create'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Store Delete Confirmation */}
      <AlertDialog open={!!deleteStore} onOpenChange={() => setDeleteStore(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Store?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteStore?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleStoreDelete} className="bg-red-600 hover:bg-red-700">
              Delete Store
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}