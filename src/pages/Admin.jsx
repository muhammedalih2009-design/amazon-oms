import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { format } from 'date-fns';
import { 
  Shield, Users, Building2, CreditCard, Search, 
  CheckCircle, XCircle, RefreshCw, Download, Eye, Trash2, AlertTriangle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
} from "@/components/ui/alert-dialog";
import { Label } from '@/components/ui/label';
import DataTable from '@/components/shared/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function Admin() {
  const { isPlatformAdmin, user } = useTenant();
  const { toast } = useToast();
  const [tenants, setTenants] = useState([]);
  const [users, setUsers] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [showResetConfirm1, setShowResetConfirm1] = useState(false);
  const [showResetConfirm2, setShowResetConfirm2] = useState(false);
  const [showResetConfirm3, setShowResetConfirm3] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [resetting, setResetting] = useState(false);
  const [tenantToReset, setTenantToReset] = useState(null);

  useEffect(() => {
    if (isPlatformAdmin) {
      loadData();
    }
  }, [isPlatformAdmin]);

  const loadData = async () => {
    setLoading(true);
    const [tenantsData, usersData, membershipsData, subscriptionsData] = await Promise.all([
      base44.entities.Tenant.list(),
      base44.entities.User.list(),
      base44.entities.Membership.list(),
      base44.entities.Subscription.list()
    ]);
    setTenants(tenantsData);
    setUsers(usersData);
    setMemberships(membershipsData);
    setSubscriptions(subscriptionsData);
    setLoading(false);
  };

  const updateSubscription = async (tenantId, updates) => {
    const sub = subscriptions.find(s => s.tenant_id === tenantId);
    if (sub) {
      await base44.entities.Subscription.update(sub.id, updates);
      toast({ title: 'Subscription updated' });
      loadData();
    }
  };

  const getTenantStats = (tenantId) => {
    const memberCount = memberships.filter(m => m.tenant_id === tenantId).length;
    const sub = subscriptions.find(s => s.tenant_id === tenantId);
    return { memberCount, subscription: sub };
  };

  const handleResetTenantData = async () => {
    if (!tenantToReset) return;
    
    setResetting(true);
    try {
      const tenantId = tenantToReset.id;

      // Delete in proper order respecting foreign keys
      // 1. Delete StockMovements (references SKUs and OrderLines)
      const movements = await base44.entities.StockMovement.filter({ tenant_id: tenantId });
      for (const mov of movements) {
        await base44.entities.StockMovement.delete(mov.id);
      }

      // 2. Delete ImportErrors (references ImportBatch)
      const errors = await base44.entities.ImportError.filter({ tenant_id: tenantId });
      for (const err of errors) {
        await base44.entities.ImportError.delete(err.id);
      }

      // 3. Delete OrderLines (references Orders and SKUs)
      const orderLines = await base44.entities.OrderLine.filter({ tenant_id: tenantId });
      for (const line of orderLines) {
        await base44.entities.OrderLine.delete(line.id);
      }

      // 4. Delete Orders
      const orders = await base44.entities.Order.filter({ tenant_id: tenantId });
      for (const order of orders) {
        await base44.entities.Order.delete(order.id);
      }

      // 5. Delete Purchases (references SKUs)
      const purchases = await base44.entities.Purchase.filter({ tenant_id: tenantId });
      for (const purchase of purchases) {
        await base44.entities.Purchase.delete(purchase.id);
      }

      // 6. Delete CurrentStock (references SKUs)
      const stock = await base44.entities.CurrentStock.filter({ tenant_id: tenantId });
      for (const s of stock) {
        await base44.entities.CurrentStock.delete(s.id);
      }

      // 7. Delete PurchaseCart (references SKUs)
      const cart = await base44.entities.PurchaseCart.filter({ tenant_id: tenantId });
      for (const item of cart) {
        await base44.entities.PurchaseCart.delete(item.id);
      }

      // 8. Delete ImportBatches
      const batches = await base44.entities.ImportBatch.filter({ tenant_id: tenantId });
      for (const batch of batches) {
        await base44.entities.ImportBatch.delete(batch.id);
      }

      // 9. Delete SKUs (must be last as everything else references them)
      const skus = await base44.entities.SKU.filter({ tenant_id: tenantId });
      for (const sku of skus) {
        await base44.entities.SKU.delete(sku.id);
      }

      // 10. Delete Suppliers
      const suppliers = await base44.entities.Supplier.filter({ tenant_id: tenantId });
      for (const supplier of suppliers) {
        await base44.entities.Supplier.delete(supplier.id);
      }

      // 11. Delete Tasks
      const tasks = await base44.entities.Task.filter({ tenant_id: tenantId });
      for (const task of tasks) {
        // Delete task checklists
        const checklists = await base44.entities.TaskChecklistItem.filter({ task_id: task.id });
        for (const item of checklists) {
          await base44.entities.TaskChecklistItem.delete(item.id);
        }
        // Delete task comments
        const comments = await base44.entities.TaskComment.filter({ task_id: task.id });
        for (const comment of comments) {
          await base44.entities.TaskComment.delete(comment.id);
        }
        await base44.entities.Task.delete(task.id);
      }

      // Log the action
      console.log(`MASTER RESET performed by ${user.email} on tenant ${tenantToReset.name} (${tenantId}) at ${new Date().toISOString()}`);

      toast({
        title: '✓ Master Reset Complete',
        description: `All data for "${tenantToReset.name}" has been permanently deleted.`
      });

      // Close dialogs and refresh
      setShowResetConfirm3(false);
      setShowResetConfirm2(false);
      setShowResetConfirm1(false);
      setTenantToReset(null);
      setResetConfirmation('');
      loadData();
    } catch (error) {
      console.error('Reset failed:', error);
      toast({
        title: 'Reset failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setResetting(false);
    }
  };

  const initiateReset = (tenant) => {
    setTenantToReset(tenant);
    setShowResetConfirm1(true);
  };

  const proceedToStep2 = () => {
    setShowResetConfirm1(false);
    setShowResetConfirm2(true);
  };

  const proceedToStep3 = () => {
    if (resetConfirmation.toUpperCase() === 'DELETE' || resetConfirmation === tenantToReset?.name) {
      setShowResetConfirm2(false);
      setShowResetConfirm3(true);
    } else {
      toast({
        title: 'Confirmation failed',
        description: 'Please type "DELETE" or the exact workspace name to proceed.',
        variant: 'destructive'
      });
    }
  };

  const cancelReset = () => {
    setShowResetConfirm1(false);
    setShowResetConfirm2(false);
    setShowResetConfirm3(false);
    setTenantToReset(null);
    setResetConfirmation('');
  };

  if (!isPlatformAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
          <Shield className="w-8 h-8 text-red-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-2">Access Denied</h2>
        <p className="text-slate-500">You don't have permission to access this page.</p>
      </div>
    );
  }

  const tenantColumns = [
    {
      key: 'name',
      header: 'Workspace',
      render: (val, row) => (
        <div>
          <span className="font-medium text-slate-900">{val}</span>
          <p className="text-xs text-slate-500">{row.slug}</p>
        </div>
      )
    },
    {
      key: 'created_date',
      header: 'Created',
      render: (val) => format(new Date(val), 'MMM d, yyyy')
    },
    {
      key: 'members',
      header: 'Members',
      render: (_, row) => {
        const stats = getTenantStats(row.id);
        return stats.memberCount;
      }
    },
    {
      key: 'plan',
      header: 'Plan',
      render: (_, row) => {
        const stats = getTenantStats(row.id);
        return <StatusBadge status={stats.subscription?.plan || 'free'} />;
      }
    },
    {
      key: 'status',
      header: 'Status',
      render: (_, row) => {
        const stats = getTenantStats(row.id);
        return <StatusBadge status={stats.subscription?.status || 'inactive'} />;
      }
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (_, row) => {
        const stats = getTenantStats(row.id);
        return (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setSelectedTenant(row)}>
              <Eye className="w-4 h-4" />
            </Button>
            {stats.subscription?.status === 'active' ? (
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => updateSubscription(row.id, { status: 'inactive' })}
                className="text-red-600"
              >
                <XCircle className="w-4 h-4" />
              </Button>
            ) : (
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => updateSubscription(row.id, { status: 'active' })}
                className="text-emerald-600"
              >
                <CheckCircle className="w-4 h-4" />
              </Button>
            )}
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => initiateReset(row)}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        );
      }
    }
  ];

  const userColumns = [
    {
      key: 'full_name',
      header: 'Name',
      render: (val, row) => (
        <div>
          <span className="font-medium text-slate-900">{val || 'No name'}</span>
          <p className="text-xs text-slate-500">{row.email}</p>
        </div>
      )
    },
    {
      key: 'role',
      header: 'Role',
      render: (val) => <StatusBadge status={val || 'user'} />
    },
    {
      key: 'created_date',
      header: 'Joined',
      render: (val) => format(new Date(val), 'MMM d, yyyy')
    },
    {
      key: 'workspace',
      header: 'Workspace',
      render: (_, row) => {
        const mem = memberships.find(m => m.user_email === row.email);
        const tenant = tenants.find(t => t.id === mem?.tenant_id);
        return tenant?.name || '-';
      }
    }
  ];

  const filteredTenants = tenants.filter(t =>
    t.name?.toLowerCase().includes(search.toLowerCase()) ||
    t.slug?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="p-3 bg-red-100 rounded-xl">
          <Shield className="w-6 h-6 text-red-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Platform Admin</h1>
          <p className="text-slate-500">Manage tenants, users, and subscriptions</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <div className="flex items-center gap-3 mb-2">
            <Building2 className="w-5 h-5 text-indigo-600" />
            <span className="text-slate-500">Tenants</span>
          </div>
          <p className="text-2xl font-bold">{tenants.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <div className="flex items-center gap-3 mb-2">
            <Users className="w-5 h-5 text-violet-600" />
            <span className="text-slate-500">Users</span>
          </div>
          <p className="text-2xl font-bold">{users.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <div className="flex items-center gap-3 mb-2">
            <CreditCard className="w-5 h-5 text-emerald-600" />
            <span className="text-slate-500">Active Subs</span>
          </div>
          <p className="text-2xl font-bold">
            {subscriptions.filter(s => s.status === 'active').length}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <div className="flex items-center gap-3 mb-2">
            <CreditCard className="w-5 h-5 text-violet-600" />
            <span className="text-slate-500">Pro Plans</span>
          </div>
          <p className="text-2xl font-bold">
            {subscriptions.filter(s => s.plan === 'pro').length}
          </p>
        </div>
      </div>

      <Tabs defaultValue="tenants" className="space-y-6">
        <TabsList>
          <TabsTrigger value="tenants">Tenants</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
        </TabsList>

        <TabsContent value="tenants" className="space-y-4">
          <div className="flex gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search tenants..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button variant="outline" onClick={loadData}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>

          <DataTable
            columns={tenantColumns}
            data={filteredTenants}
            loading={loading}
            emptyIcon={Building2}
            emptyTitle="No tenants"
            emptyDescription="No workspaces have been created yet"
          />
        </TabsContent>

        <TabsContent value="users">
          <DataTable
            columns={userColumns}
            data={users}
            loading={loading}
            emptyIcon={Users}
            emptyTitle="No users"
            emptyDescription="No users have signed up yet"
          />
        </TabsContent>
      </Tabs>

      {/* Tenant Details Dialog */}
      <Dialog open={!!selectedTenant} onOpenChange={() => setSelectedTenant(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Tenant Details</DialogTitle>
          </DialogHeader>
          {selectedTenant && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-slate-500">Workspace Name</p>
                  <p className="font-medium">{selectedTenant.name}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">Created</p>
                  <p className="font-medium">
                    {format(new Date(selectedTenant.created_date), 'MMM d, yyyy')}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-sm text-slate-500 mb-2">Subscription</p>
                <div className="flex gap-2">
                  <Select
                    value={getTenantStats(selectedTenant.id).subscription?.plan || 'free'}
                    onValueChange={(val) => updateSubscription(selectedTenant.id, { plan: val })}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">Free</SelectItem>
                      <SelectItem value="trial">Trial</SelectItem>
                      <SelectItem value="pro">Pro</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={getTenantStats(selectedTenant.id).subscription?.status || 'inactive'}
                    onValueChange={(val) => updateSubscription(selectedTenant.id, { status: val })}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="past_due">Past Due</SelectItem>
                      <SelectItem value="canceled">Canceled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <p className="text-sm text-slate-500 mb-2">Members</p>
                <div className="space-y-2">
                  {memberships
                    .filter(m => m.tenant_id === selectedTenant.id)
                    .map(mem => {
                      const u = users.find(usr => usr.email === mem.user_email);
                      return (
                        <div key={mem.id} className="flex justify-between p-2 bg-slate-50 rounded-lg">
                          <span>{u?.full_name || mem.user_email}</span>
                          <StatusBadge status={mem.role} />
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Step 1: Initial Warning */}
      <AlertDialog open={showResetConfirm1} onOpenChange={cancelReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-6 h-6" />
              Factory Reset - Delete All Data
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4">
                  <p className="text-sm font-bold text-red-900 mb-2">⚠ CRITICAL WARNING</p>
                  <p className="text-sm text-red-800">
                    You are about to permanently delete ALL data for workspace: <strong>{tenantToReset?.name}</strong>
                  </p>
                </div>

                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-sm font-semibold text-slate-900 mb-2">This will delete:</p>
                  <ul className="text-sm text-slate-700 space-y-1 list-disc list-inside">
                    <li>All SKUs and Products</li>
                    <li>All Orders and Order Lines</li>
                    <li>All Purchases and Purchase History</li>
                    <li>All Stock Movements and Audit Trails</li>
                    <li>All Import Batches and Errors</li>
                    <li>All Suppliers</li>
                    <li>All Tasks and Comments</li>
                  </ul>
                </div>

                <p className="text-sm text-red-800 font-semibold">
                  Are you sure you want to proceed?
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelReset}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={proceedToStep2} className="bg-red-600 hover:bg-red-700">
              Yes, Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Step 2: Hard Confirmation */}
      <AlertDialog open={showResetConfirm2} onOpenChange={cancelReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-6 h-6" />
              Confirm Master Reset
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4">
                  <p className="text-sm font-bold text-red-900 mb-2">⚠ FINAL CONFIRMATION REQUIRED</p>
                  <p className="text-sm text-red-800">
                    To confirm deletion of ALL data for <strong>{tenantToReset?.name}</strong>, 
                    please type the word <strong className="text-red-900">DELETE</strong> or the exact workspace name below:
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reset-confirm" className="text-base font-semibold text-slate-900">
                    Type "DELETE" or "{tenantToReset?.name}" to proceed *
                  </Label>
                  <Input
                    id="reset-confirm"
                    value={resetConfirmation}
                    onChange={(e) => setResetConfirmation(e.target.value)}
                    placeholder="Type here..."
                    className="text-lg border-2 border-red-300 focus:border-red-500"
                  />
                </div>

                <p className="text-xs text-slate-600">
                  This action will be logged with your email and timestamp for audit purposes.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelReset}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={proceedToStep3}
              disabled={!resetConfirmation}
              className="bg-red-600 hover:bg-red-700"
            >
              Verify & Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Step 3: Final Confirmation */}
      <AlertDialog open={showResetConfirm3} onOpenChange={cancelReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-6 h-6" />
              Execute Master Reset?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4">
                  <p className="text-sm font-bold text-red-900 mb-2">⚠ LAST CHANCE TO CANCEL</p>
                  <p className="text-sm text-red-800">
                    This is your final confirmation. Once you click "Execute Reset", ALL data for 
                    <strong> {tenantToReset?.name}</strong> will be permanently deleted and CANNOT be recovered.
                  </p>
                </div>

                <div className="bg-slate-100 rounded-lg p-3">
                  <p className="text-xs text-slate-600">
                    <strong>Audit Log:</strong> This action will be logged as:
                  </p>
                  <p className="text-xs text-slate-700 font-mono mt-1">
                    Master Reset by {user?.email} on {format(new Date(), 'yyyy-MM-dd HH:mm:ss')}
                  </p>
                </div>

                <p className="text-sm text-red-800 font-bold">
                  Proceed with complete data deletion?
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelReset}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleResetTenantData}
              disabled={resetting}
              className="bg-red-600 hover:bg-red-700"
            >
              {resetting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Execute Reset
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}