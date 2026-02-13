import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { Shield, Users, Building2, Plus, Edit, Trash2, Eye, Ban, CheckCircle, XCircle } from 'lucide-react';
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
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import RefreshButton from '@/components/shared/RefreshButton';

export default function AdminPage() {
  const { user, isPlatformAdmin } = useTenant();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [showEditWorkspace, setShowEditWorkspace] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    plan: 'trial',
    status: 'active'
  });

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user]);

  const loadData = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const [tenantsData, usersData, membershipsData, subscriptionsData] = await Promise.all([
        base44.entities.Tenant.filter({}),
        base44.entities.User.filter({}),
        base44.entities.Membership.filter({}),
        base44.entities.Subscription.filter({})
      ]);

      setWorkspaces(tenantsData);
      setAllUsers(usersData);
      setMemberships(membershipsData);
      setSubscriptions(subscriptionsData);
    } catch (error) {
      toast({
        title: 'Failed to load data',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      if (isRefresh) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  };

  const handleCreateWorkspace = async (e) => {
    e.preventDefault();
    
    try {
      const newTenant = await base44.entities.Tenant.create({
        name: formData.name,
        slug: formData.slug || formData.name.toLowerCase().replace(/\s+/g, '-'),
        settings: {}
      });

      await base44.entities.Subscription.create({
        tenant_id: newTenant.id,
        plan: formData.plan,
        status: 'active',
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      });

      toast({
        title: 'Workspace created',
        description: `${formData.name} has been created successfully`
      });

      setShowCreateWorkspace(false);
      setFormData({ name: '', slug: '', plan: 'trial', status: 'active' });
      loadData(true);
    } catch (error) {
      toast({
        title: 'Failed to create workspace',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleUpdateWorkspace = async (workspace, updates) => {
    try {
      // Update subscription if plan changed
      if (updates.plan) {
        const sub = subscriptions.find(s => s.tenant_id === workspace.id);
        if (sub) {
          await base44.entities.Subscription.update(sub.id, {
            plan: updates.plan
          });
        }
      }

      // Update subscription status if status changed
      if (updates.status) {
        const sub = subscriptions.find(s => s.tenant_id === workspace.id);
        if (sub) {
          await base44.entities.Subscription.update(sub.id, {
            status: updates.status
          });
        }
      }

      toast({
        title: 'Workspace updated',
        description: `${workspace.name} has been updated`
      });

      loadData(true);
    } catch (error) {
      toast({
        title: 'Failed to update workspace',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleDeleteWorkspace = async (workspace) => {
    try {
      // Delete memberships
      const workspaceMemberships = memberships.filter(m => m.tenant_id === workspace.id);
      for (const membership of workspaceMemberships) {
        await base44.entities.Membership.delete(membership.id);
      }

      // Delete subscription
      const sub = subscriptions.find(s => s.tenant_id === workspace.id);
      if (sub) {
        await base44.entities.Subscription.delete(sub.id);
      }

      // Delete tenant
      await base44.entities.Tenant.delete(workspace.id);

      toast({
        title: 'Workspace deleted',
        description: `${workspace.name} has been deleted`
      });

      setShowDeleteConfirm(null);
      loadData(true);
    } catch (error) {
      toast({
        title: 'Failed to delete workspace',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const getWorkspaceMembers = (workspaceId) => {
    return memberships.filter(m => m.tenant_id === workspaceId);
  };

  const getWorkspaceSubscription = (workspaceId) => {
    return subscriptions.find(s => s.tenant_id === workspaceId);
  };

  if (!isPlatformAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-4">
          <Ban className="w-16 h-16 text-red-500 mx-auto" />
          <h1 className="text-2xl font-bold text-slate-900">Access Denied</h1>
          <p className="text-slate-600">You don't have permission to access Platform Admin.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-red-600 to-orange-600 rounded-xl flex items-center justify-center">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Platform Admin</h1>
            <p className="text-slate-500">Manage workspaces and users</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <RefreshButton onRefresh={() => loadData(true)} loading={refreshing} />
          <Button
            onClick={() => setShowCreateWorkspace(true)}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Workspace
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center gap-3">
            <Building2 className="w-8 h-8 text-indigo-600" />
            <div>
              <p className="text-sm text-slate-500">Total Workspaces</p>
              <p className="text-2xl font-bold text-slate-900">{workspaces.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center gap-3">
            <Users className="w-8 h-8 text-emerald-600" />
            <div>
              <p className="text-sm text-slate-500">Total Users</p>
              <p className="text-2xl font-bold text-slate-900">{allUsers.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-8 h-8 text-blue-600" />
            <div>
              <p className="text-sm text-slate-500">Active Subscriptions</p>
              <p className="text-2xl font-bold text-slate-900">
                {subscriptions.filter(s => s.status === 'active').length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Workspaces Table */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="p-6 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Workspaces</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-600">Workspace</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-600">Members</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-600">Plan</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-600">Status</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-slate-600">Created</th>
                <th className="text-right py-3 px-6 text-xs font-semibold text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map(workspace => {
                const members = getWorkspaceMembers(workspace.id);
                const subscription = getWorkspaceSubscription(workspace.id);
                
                return (
                  <tr key={workspace.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-4 px-6">
                      <div>
                        <p className="font-medium text-slate-900">{workspace.name}</p>
                        <p className="text-sm text-slate-500">{workspace.slug}</p>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-slate-400" />
                        <span className="text-sm text-slate-600">{members.length}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <Select
                        value={subscription?.plan || 'free'}
                        onValueChange={(value) => handleUpdateWorkspace(workspace, { plan: value })}
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
                    </td>
                    <td className="py-4 px-6">
                      <Select
                        value={subscription?.status || 'inactive'}
                        onValueChange={(value) => handleUpdateWorkspace(workspace, { status: value })}
                      >
                        <SelectTrigger className="w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">
                            <div className="flex items-center gap-2">
                              <CheckCircle className="w-4 h-4 text-emerald-600" />
                              Active
                            </div>
                          </SelectItem>
                          <SelectItem value="past_due">
                            <div className="flex items-center gap-2">
                              <XCircle className="w-4 h-4 text-amber-600" />
                              Past Due
                            </div>
                          </SelectItem>
                          <SelectItem value="canceled">
                            <div className="flex items-center gap-2">
                              <Ban className="w-4 h-4 text-red-600" />
                              Canceled
                            </div>
                          </SelectItem>
                          <SelectItem value="inactive">
                            <div className="flex items-center gap-2">
                              <XCircle className="w-4 h-4 text-slate-400" />
                              Inactive
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-600">
                      {new Date(workspace.created_date).toLocaleDateString()}
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setShowDeleteConfirm(workspace)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Workspace Dialog */}
      <Dialog open={showCreateWorkspace} onOpenChange={setShowCreateWorkspace}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Workspace</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateWorkspace} className="space-y-4">
            <div className="space-y-2">
              <Label>Workspace Name *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="My Company"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Slug (URL-friendly)</Label>
              <Input
                value={formData.slug}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                placeholder="my-company"
              />
            </div>
            <div className="space-y-2">
              <Label>Plan</Label>
              <Select
                value={formData.plan}
                onValueChange={(value) => setFormData({ ...formData, plan: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="trial">Trial</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => setShowCreateWorkspace(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700">
                Create Workspace
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!showDeleteConfirm} onOpenChange={() => setShowDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{showDeleteConfirm?.name}</strong> and all associated data. 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleDeleteWorkspace(showDeleteConfirm)}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete Workspace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}