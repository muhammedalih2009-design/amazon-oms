import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { format } from 'date-fns';
import { 
  Shield, Users, Building2, CreditCard, Search, 
  CheckCircle, XCircle, RefreshCw, Download, Eye
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
    </div>
  );
}