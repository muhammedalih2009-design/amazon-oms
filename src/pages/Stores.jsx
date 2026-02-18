import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { Store, Plus, Edit, Trash2, Package, RefreshCw } from 'lucide-react';
import RefreshButton from '@/components/shared/RefreshButton';
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
import { useToast } from '@/components/ui/use-toast';
import DataTable from '@/components/shared/DataTable';
import WorkspacePackageManager from '@/components/stores/WorkspacePackageManager';
import BackupManager from '@/components/stores/BackupManager';
import PaywallBanner from '@/components/ui/PaywallBanner';
import PremiumCollapsibleSection from '@/components/shared/PremiumCollapsibleSection';
import { Package, Database, Store as StoreIcon, Download, Plus } from 'lucide-react';

export default function Stores() {
  const { tenantId, tenant, subscription } = useTenant();
  const { toast } = useToast();
  const [stores, setStores] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingStore, setEditingStore] = useState(null);
  const [deleteStore, setDeleteStore] = useState(null);
  const [storesLoaded, setStoresLoaded] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    platform: 'Amazon',
    color: '#6366f1'
  });

  const platformColors = {
    Amazon: '#FF9900',
    Noon: '#FED530',
    Jumia: '#F47920',
    Other: '#6366f1'
  };

  const loadStoresData = async () => {
    if (storesLoaded) return;
    
    setLoading(true);
    const [storesData, ordersData] = await Promise.all([
      base44.entities.Store.filter({ tenant_id: tenantId }),
      base44.entities.Order.filter({ tenant_id: tenantId })
    ]);
    setStores(storesData);
    setOrders(ordersData);
    setStoresLoaded(true);
    setLoading(false);
  };

  const loadData = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    }
    const [storesData, ordersData] = await Promise.all([
      base44.entities.Store.filter({ tenant_id: tenantId }),
      base44.entities.Order.filter({ tenant_id: tenantId })
    ]);
    setStores(storesData);
    setOrders(ordersData);
    setStoresLoaded(true);
    if (isRefresh) {
      setRefreshing(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (editingStore) {
      await base44.entities.Store.update(editingStore.id, formData);
      toast({ title: 'Store updated successfully' });
    } else {
      await base44.entities.Store.create({
        tenant_id: tenantId,
        ...formData
      });
      toast({ title: 'Store created successfully' });
    }

    setShowForm(false);
    setEditingStore(null);
    setFormData({ name: '', platform: 'Amazon', color: '#6366f1' });
    loadData();
  };

  const handleEdit = (store) => {
    setEditingStore(store);
    setFormData({
      name: store.name,
      platform: store.platform,
      color: store.color || platformColors[store.platform]
    });
    setShowForm(true);
  };

  const handleDelete = async () => {
    if (!deleteStore) return;
    
    // Check if store has orders
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

    await base44.entities.Store.delete(deleteStore.id);
    setDeleteStore(null);
    loadData();
    toast({ title: 'Store deleted successfully' });
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
      
      // Reload data to reflect changes
      await loadData(true);
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

  const columns = [
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
          <Button variant="ghost" size="icon" onClick={() => handleEdit(row)}>
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

  return (
    <div className="space-y-6">
      <PaywallBanner subscription={subscription} onUpgrade={() => {}} />

      <PremiumCollapsibleSection
        id="workspace_data_package"
        icon={Package}
        title="Workspace Data Package"
        subtitle="Export/import workspace data"
        defaultOpen={false}
        workspaceId={tenantId}
        headerActions={[
          {
            label: 'Download',
            icon: Download,
            variant: 'outline',
            onClick: () => {
              // Trigger download action
              toast({ title: 'Download started' });
            }
          }
        ]}
      >
        <WorkspacePackageManager 
          tenantId={tenantId} 
          tenantName={tenant?.name || 'Workspace'}
          onComplete={() => loadData(true)}
        />
      </PremiumCollapsibleSection>

      <PremiumCollapsibleSection
        id="backup_restore"
        icon={Database}
        title="Backup & Restore"
        subtitle="Snapshots & restore with recompute"
        defaultOpen={false}
        workspaceId={tenantId}
        headerActions={[
          {
            label: 'Create Backup',
            icon: Plus,
            variant: 'default',
            className: 'bg-indigo-600 hover:bg-indigo-700 text-white',
            onClick: () => {
              // Trigger create backup action
              toast({ title: 'Creating backup...' });
            }
          }
        ]}
      >
        <BackupManager tenantId={tenantId} />
      </PremiumCollapsibleSection>

      <PremiumCollapsibleSection
        id="stores_sales_channels"
        icon={StoreIcon}
        title="Stores & Sales Channels"
        subtitle="Manage stores and integrations"
        defaultOpen={false}
        workspaceId={tenantId}
        onOpen={loadStoresData}
        headerActions={[
          {
            label: 'Add Store',
            icon: Plus,
            variant: 'default',
            className: 'bg-indigo-600 hover:bg-indigo-700 text-white',
            onClick: () => {
              setEditingStore(null);
              setFormData({ name: '', platform: 'Amazon', color: '#6366f1' });
              setShowForm(true);
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
          <RefreshButton onRefresh={() => loadData(true)} loading={refreshing} />
          <Button 
            onClick={() => {
              setEditingStore(null);
              setFormData({ name: '', platform: 'Amazon', color: '#6366f1' });
              setShowForm(true);
            }}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Store
          </Button>
        </div>
      </div>

          <DataTable
            columns={columns}
            data={stores}
            loading={loading}
            emptyIcon={Store}
            emptyTitle="No stores yet"
            emptyDescription="Add your first store to start tracking orders by channel"
            emptyAction="Add Store"
            onEmptyAction={() => setShowForm(true)}
          />
        </div>
      </CollapsibleSection>

      {/* Add/Edit Store Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingStore ? 'Edit Store' : 'Add New Store'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Store Name *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                placeholder="e.g., Arexol, Homera"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Platform *</Label>
              <Select 
                value={formData.platform} 
                onValueChange={(val) => setFormData({
                  ...formData, 
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
                  value={formData.color}
                  onChange={(e) => setFormData({...formData, color: e.target.value})}
                  className="w-20 h-10"
                />
                <span className="text-sm text-slate-500">{formData.color}</span>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => {
                setShowForm(false);
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

      {/* Delete Confirmation */}
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
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              Delete Store
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}