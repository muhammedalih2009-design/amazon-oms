import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { Shield, Users, Building2, Plus, Edit, Trash2, Eye, Ban, CheckCircle, XCircle, Settings, Copy } from 'lucide-react';
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
import UserAutocomplete from '@/components/shared/UserAutocomplete';
import TelegramSettings from '@/components/admin/TelegramSettings';
import ExportSettings from '@/components/admin/ExportSettings';
import DeleteLinkVerification from '@/components/admin/DeleteLinkVerification';
import CloneWorkspaceModal from '@/components/admin/CloneWorkspaceModal';
import ModuleSelector from '@/components/admin/ModuleSelector';
import RecentWorkspacesMonitor from '@/components/admin/RecentWorkspacesMonitor';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
  const [showMembersModal, setShowMembersModal] = useState(null);
  const [workspaceMembers, setWorkspaceMembers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [addMemberRole, setAddMemberRole] = useState('member');
  const [repairingMemberships, setRepairingMemberships] = useState(false);
  const [cloneWorkspaceOpen, setCloneWorkspaceOpen] = useState(false);
  const [cloneSourceWorkspace, setCloneSourceWorkspace] = useState(null);
  
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    plan: 'trial',
    status: 'active',
    admin_email: '',
    admin_role: 'owner'
  });
  const [selectedModules, setSelectedModules] = useState([]);
  const [inviteLink, setInviteLink] = useState(null);

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

      // P0 FIX: Filter out deleted workspaces
      const activeWorkspaces = tenantsData.filter(w => !w.deleted_at);
      
      setWorkspaces(activeWorkspaces);
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

  const [creatingWorkspace, setCreatingWorkspace] = useState(false);

  const handleCreateWorkspace = async (e) => {
    e.preventDefault();
    
    if (selectedModules.length === 0) {
      toast({
        title: 'No modules selected',
        description: 'Please enable at least one module',
        variant: 'destructive'
      });
      return;
    }

    if (!formData.admin_email) {
      toast({
        title: 'Admin email required',
        description: 'Please specify a primary workspace admin',
        variant: 'destructive'
      });
      return;
    }
    
    setCreatingWorkspace(true);
    
    try {
      const response = await base44.functions.invoke('createWorkspaceWithAdmin', {
        workspace_name: formData.name,
        slug: formData.slug || formData.name.toLowerCase().replace(/\s+/g, '-'),
        plan: formData.plan,
        enabled_modules: selectedModules,
        admin_email: formData.admin_email,
        admin_role: formData.admin_role
      });

      if (response.data.ok) {
        const { mode, invite_token, admin_email } = response.data;

        if (mode === 'invite_created' && invite_token) {
          // Build invite link with current app domain
          const inviteLink = `${window.location.origin}/AcceptInvite?token=${invite_token}`;
          setInviteLink(inviteLink);
          toast({
            title: 'Workspace created with invite',
            description: `Invite link generated for ${admin_email}`
          });
        } else {
          toast({
            title: 'Workspace created',
            description: `Admin ${admin_email} added successfully`
          });
          setShowCreateWorkspace(false);
          setFormData({ name: '', slug: '', plan: 'trial', status: 'active', admin_email: '', admin_role: 'owner' });
          setSelectedModules([]);
          loadData(true);
        }
      } else {
        throw new Error(response.data.error || 'Creation failed');
      }
    } catch (error) {
      toast({
        title: 'Failed to create workspace',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setCreatingWorkspace(false);
    }
  };

  const handleCloseCreateDialog = () => {
    setShowCreateWorkspace(false);
    setInviteLink(null);
    setFormData({ name: '', slug: '', plan: 'trial', status: 'active', admin_email: '', admin_role: 'owner' });
    setSelectedModules([]);
    loadData(true);
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
      // P0 FIX: Use proper soft-delete function
      const response = await base44.functions.invoke('deleteWorkspace', {
        workspace_id: workspace.id
      });

      if (response.data.success) {
        toast({
          title: 'Workspace deleted',
          description: `${workspace.name} has been deleted (${response.data.memberships_removed} memberships removed)`
        });

        setShowDeleteConfirm(null);
        loadData(true);
      } else {
        throw new Error(response.data.error || 'Deletion failed');
      }
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

  const handleViewWorkspace = (workspace) => {
    // Switch to this workspace
    localStorage.setItem('active_workspace_id', workspace.id);
    window.location.href = '/';
  };

  const loadWorkspaceMembers = async (workspaceId) => {
    try {
      const { data } = await base44.functions.invoke('manageWorkspaceMembers', {
        action: 'list',
        workspace_id: workspaceId
      });

      if (data.ok) {
        setWorkspaceMembers(data.members);
      }
    } catch (error) {
      toast({
        title: 'Failed to load members',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleAddMember = async (workspaceId) => {
    if (!selectedUser) {
      toast({
        title: 'No user selected',
        description: 'Please select a user to add',
        variant: 'destructive'
      });
      return;
    }

    try {
      const { data } = await base44.functions.invoke('manageWorkspaceMembers', {
        action: 'add',
        workspace_id: workspaceId,
        user_email: selectedUser.email,
        role: addMemberRole
      });

      if (data.ok) {
        toast({
          title: 'Member added',
          description: `${selectedUser.email} has been added to the workspace`
        });
        setSelectedUser(null);
        setAddMemberRole('member');
        loadWorkspaceMembers(workspaceId);
      }
    } catch (error) {
      toast({
        title: 'Failed to add member',
        description: error.response?.data?.error || error.message,
        variant: 'destructive'
      });
    }
  };

  const handleUpdateMemberRole = async (memberId, workspaceId, newRole) => {
    try {
      await base44.functions.invoke('manageWorkspaceMembers', {
        action: 'update_role',
        member_id: memberId,
        role: newRole
      });

      toast({
        title: 'Role updated',
        description: 'Member role has been updated'
      });
      loadWorkspaceMembers(workspaceId);
    } catch (error) {
      toast({
        title: 'Failed to update role',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleRemoveMember = async (memberId, workspaceId) => {
    try {
      const { data } = await base44.functions.invoke('manageWorkspaceMembers', {
        action: 'remove',
        member_id: memberId
      });

      if (data.ok) {
        toast({
          title: 'Member removed',
          description: 'Member has been removed from the workspace'
        });
        loadWorkspaceMembers(workspaceId);
      }
    } catch (error) {
      toast({
        title: 'Failed to remove member',
        description: error.response?.data?.error || error.message,
        variant: 'destructive'
      });
    }
  };

  // Strict platform admin check
  const isSuperAdmin = user?.role === 'admin' || user?.email === 'admin@amazonoms.com';
  
  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-4">
          <Ban className="w-16 h-16 text-red-500 mx-auto" />
          <h1 className="text-2xl font-bold text-slate-900">Access Denied</h1>
          <p className="text-slate-600">Only Super Admins can access Platform Admin.</p>
          <Button onClick={() => window.location.href = '/'} className="mt-4">
            Go to Dashboard
          </Button>
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
            <p className="text-slate-500">Manage workspaces, users, and integrations</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button 
            variant="outline"
            onClick={async () => {
              setRepairingMemberships(true);
              try {
                const { data } = await base44.functions.invoke('repairSuperAdminMemberships', {});
                toast({
                  title: 'Memberships Repaired',
                  description: `Created: ${data.memberships_created}, Skipped: ${data.memberships_skipped}`
                });
                loadData(true);
              } catch (error) {
                toast({
                  title: 'Repair failed',
                  description: error.message,
                  variant: 'destructive'
                });
              } finally {
                setRepairingMemberships(false);
              }
            }}
            disabled={repairingMemberships}
          >
            {repairingMemberships ? 'Repairing...' : 'Repair My Access'}
          </Button>
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

      <Tabs defaultValue="workspaces" className="space-y-6">
        <TabsList>
          <TabsTrigger value="workspaces">
            <Building2 className="w-4 h-4 mr-2" />
            Workspaces
          </TabsTrigger>
          {user?.email === 'muhammedalih.2009@gmail.com' && (
            <TabsTrigger value="users">
              <Users className="w-4 h-4 mr-2" />
              Users
            </TabsTrigger>
          )}
          <TabsTrigger value="integrations">
            <Settings className="w-4 h-4 mr-2" />
            Integrations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="workspaces" className="space-y-6">
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
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Workspaces</h2>
          </div>
          {/* P0 MONITORING: Recent workspace creations */}
          <RecentWorkspacesMonitor />
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
                          size="sm"
                          onClick={() => handleViewWorkspace(workspace)}
                          className="text-indigo-600 hover:text-indigo-700"
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          View
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setCloneSourceWorkspace(workspace);
                            setCloneWorkspaceOpen(true);
                          }}
                          className="text-emerald-600 hover:text-emerald-700"
                        >
                          <Copy className="w-4 h-4 mr-1" />
                          Clone
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setShowMembersModal(workspace);
                            loadWorkspaceMembers(workspace.id);
                          }}
                        >
                          <Users className="w-4 h-4 mr-1" />
                          Members
                        </Button>
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
        </TabsContent>

        <TabsContent value="integrations" className="space-y-6">
          <TelegramSettings />
          <ExportSettings />
          <DeleteLinkVerification />
        </TabsContent>
      </Tabs>

      {/* Create Workspace Dialog */}
      <Dialog open={showCreateWorkspace} onOpenChange={(open) => !open && handleCloseCreateDialog()}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Workspace</DialogTitle>
          </DialogHeader>

          {inviteLink ? (
            <div className="space-y-6 py-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6">
                <h3 className="font-semibold text-emerald-900 mb-2">✓ Workspace Created Successfully</h3>
                <p className="text-sm text-emerald-700 mb-4">
                  The user <strong>{formData.admin_email}</strong> doesn't have an account yet. 
                  Share this invite link with them:
                </p>
                <div className="bg-white border border-emerald-300 rounded p-3 font-mono text-sm break-all">
                  {inviteLink}
                </div>
                <div className="mt-4 flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(inviteLink);
                      toast({ title: 'Copied to clipboard' });
                    }}
                  >
                    Copy Link
                  </Button>
                  <Button
                    type="button"
                    onClick={handleCloseCreateDialog}
                  >
                    Done
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleCreateWorkspace} className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Workspace Name *</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="My Company"
                    required
                    disabled={creatingWorkspace}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Slug (URL-friendly)</Label>
                  <Input
                    value={formData.slug}
                    onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                    placeholder="my-company"
                    disabled={creatingWorkspace}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Plan</Label>
                  <Select
                    value={formData.plan}
                    onValueChange={(value) => setFormData({ ...formData, plan: value })}
                    disabled={creatingWorkspace}
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
              </div>

              <div className="border-t pt-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Workspace Admin (Primary Owner)</h3>
                <p className="text-sm text-slate-600 mb-4">
                  This person will become the workspace owner/admin. If they don't have an account, an invite link will be generated.
                </p>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Admin Email *</Label>
                    <Input
                      type="email"
                      value={formData.admin_email}
                      onChange={(e) => setFormData({ ...formData, admin_email: e.target.value })}
                      placeholder="admin@example.com"
                      required
                      disabled={creatingWorkspace}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Admin Role</Label>
                    <Select
                      value={formData.admin_role}
                      onValueChange={(value) => setFormData({ ...formData, admin_role: value })}
                      disabled={creatingWorkspace}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="owner">Owner (Recommended)</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="border-t pt-6">
                <ModuleSelector
                  selectedModules={selectedModules}
                  onChange={setSelectedModules}
                  disabled={creatingWorkspace}
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={handleCloseCreateDialog}
                  disabled={creatingWorkspace}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  className="bg-indigo-600 hover:bg-indigo-700"
                  disabled={selectedModules.length === 0 || !formData.admin_email || creatingWorkspace}
                >
                  {creatingWorkspace ? 'Creating...' : 'Create Workspace'}
                </Button>
              </div>
            </form>
          )}
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

      {/* Clone Workspace Modal */}
      <CloneWorkspaceModal
        workspace={cloneSourceWorkspace}
        open={cloneWorkspaceOpen}
        onOpenChange={setCloneWorkspaceOpen}
        onSuccess={() => {
          setCloneWorkspaceOpen(false);
          loadData(true);
        }}
      />

      {/* Members Management Modal */}
      <Dialog open={!!showMembersModal} onOpenChange={() => setShowMembersModal(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manage Members: {showMembersModal?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Add Member */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <Label className="text-sm font-medium text-blue-900 mb-3">Add New Member</Label>
              <div className="space-y-3">
                {selectedUser && (
                  <div className="bg-white border border-blue-200 rounded-lg p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
                        <Users className="w-4 h-4 text-indigo-600" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">{selectedUser.full_name}</p>
                        <p className="text-sm text-slate-500">{selectedUser.email}</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedUser(null)}
                      className="text-slate-500"
                    >
                      <XCircle className="w-4 h-4" />
                    </Button>
                  </div>
                )}
                
                <div className="flex gap-2">
                  <div className="flex-1">
                    <UserAutocomplete
                      onSelect={setSelectedUser}
                      placeholder="Search users by email or name..."
                    />
                  </div>
                  <Select value={addMemberRole} onValueChange={setAddMemberRole}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="owner">Owner</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => handleAddMember(showMembersModal.id)}
                    disabled={!selectedUser}
                    className="bg-indigo-600 hover:bg-indigo-700"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add
                  </Button>
                </div>
              </div>
            </div>

            {/* Members List */}
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              {workspaceMembers.length === 0 ? (
                <div className="p-8 text-center">
                  <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500 font-medium">No members yet</p>
                  <p className="text-sm text-slate-400 mt-1">Add users to this workspace using the form above</p>
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left py-2 px-4 text-xs font-semibold text-slate-600">User</th>
                      <th className="text-left py-2 px-4 text-xs font-semibold text-slate-600">Role</th>
                      <th className="text-right py-2 px-4 text-xs font-semibold text-slate-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workspaceMembers.map(member => (
                      <tr key={member.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-3 px-4">
                          <div>
                            <p className="font-medium text-slate-900">{member.user_name || 'Unknown User'}</p>
                            <p className="text-sm text-slate-500">{member.user_email}</p>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <Select
                            value={member.role}
                            onValueChange={(value) => handleUpdateMemberRole(member.id, showMembersModal.id, value)}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="member">Member</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="owner">Owner</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveMember(member.id, showMembersModal.id)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}