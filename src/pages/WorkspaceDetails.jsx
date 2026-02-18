import React, { useState } from 'react';
import { apiClient } from '@/components/utils/apiClient';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
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
import { Building2, Users, Plus, Trash2, Shield } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

export default function WorkspaceDetails() {
  const { toast } = useToast();
  const urlParams = new URLSearchParams(window.location.search);
  const workspaceId = urlParams.get('id');

  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('staff');
  const [memberToDelete, setMemberToDelete] = useState(null);

  const { data: workspace, refetch: refetchWorkspace } = useQuery({
    queryKey: ['admin-workspace', workspaceId],
    queryFn: async () => {
      const workspaces = await apiClient.list('Tenant', { id: workspaceId }, null, 1, { useCache: false });
      return workspaces[0];
    },
    enabled: !!workspaceId
  });

  const { data: members = [], refetch: refetchMembers } = useQuery({
    queryKey: ['admin-members', workspaceId],
    queryFn: () => apiClient.list('Membership', { tenant_id: workspaceId }, null, 100, { useCache: false }),
    enabled: !!workspaceId
  });

  const { data: modules = [], refetch: refetchModules } = useQuery({
    queryKey: ['admin-modules', workspaceId],
    queryFn: async () => {
      const data = await apiClient.invokeFunction('manageWorkspaceModules', {
        workspace_id: workspaceId,
        action: 'list'
      });
      return data.modules || [];
    },
    enabled: !!workspaceId
  });

  const handleAddMember = async () => {
    if (!newMemberEmail) {
      toast({
        title: 'Email required',
        variant: 'destructive'
      });
      return;
    }

    try {
      await apiClient.invokeFunction('manageWorkspaceMembers', {
        workspace_id: workspaceId,
        action: 'add',
        email: newMemberEmail,
        role: newMemberRole
      });

      toast({
        title: 'Member added',
        description: `${newMemberEmail} added as ${newMemberRole}`
      });

      setNewMemberEmail('');
      refetchMembers();
    } catch (error) {
      toast({
        title: 'Failed to add member',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleRemoveMember = async () => {
    if (!memberToDelete) return;

    try {
      await apiClient.invokeFunction('manageWorkspaceMembers', {
        workspace_id: workspaceId,
        action: 'remove',
        membership_id: memberToDelete.id
      });

      toast({
        title: 'Member removed',
        description: `${memberToDelete.user_email} removed from workspace`
      });

      setMemberToDelete(null);
      refetchMembers();
    } catch (error) {
      toast({
        title: 'Failed to remove member',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleToggleModule = async (moduleKey, currentEnabled) => {
    try {
      await apiClient.invokeFunction('manageWorkspaceModules', {
        workspace_id: workspaceId,
        action: 'update',
        module_key: moduleKey,
        enabled: !currentEnabled
      });

      toast({
        title: 'Module updated',
        description: `${moduleKey} ${!currentEnabled ? 'enabled' : 'disabled'}`
      });

      refetchModules();
    } catch (error) {
      toast({
        title: 'Failed to update module',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleInitializeModules = async () => {
    try {
      await apiClient.invokeFunction('manageWorkspaceModules', {
        workspace_id: workspaceId,
        action: 'initialize'
      });

      toast({
        title: 'Modules initialized',
        description: 'All modules enabled by default'
      });

      refetchModules();
    } catch (error) {
      toast({
        title: 'Failed to initialize',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  if (!workspaceId) {
    return (
      <div className="p-6">
        <p className="text-red-600">No workspace ID provided</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
          <Building2 className="w-8 h-8 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{workspace?.name || 'Workspace'}</h1>
          <p className="text-slate-600">/{workspace?.slug || 'loading...'}</p>
        </div>
      </div>

      {/* Members */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Members ({members.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add Member */}
          <div className="flex gap-3">
            <Input
              placeholder="Email address"
              value={newMemberEmail}
              onChange={(e) => setNewMemberEmail(e.target.value)}
              className="flex-1"
            />
            <Select value={newMemberRole} onValueChange={setNewMemberRole}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">Owner</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="staff">Staff</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleAddMember}>
              <Plus className="w-4 h-4 mr-2" />
              Add
            </Button>
          </div>

          {/* Members List */}
          <div className="space-y-2">
            {members.map(member => (
              <div key={member.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                    <Shield className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">{member.user_email}</p>
                    <Badge variant="outline" className="text-xs">
                      {member.role}
                    </Badge>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMemberToDelete(member)}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Modules */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Modules</CardTitle>
            {modules.length === 0 && (
              <Button onClick={handleInitializeModules} size="sm">
                Initialize All Modules
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {modules.map(module => (
              <div key={module.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="font-medium text-slate-900 capitalize">
                    {module.module_key.replace(/_/g, ' ')}
                  </p>
                  <p className="text-xs text-slate-500">{module.module_key}</p>
                </div>
                <Switch
                  checked={module.enabled}
                  onCheckedChange={() => handleToggleModule(module.module_key, module.enabled)}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Delete Member Dialog */}
      <AlertDialog open={!!memberToDelete} onOpenChange={() => setMemberToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Member?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {memberToDelete?.user_email} from this workspace?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveMember} className="bg-red-600 hover:bg-red-700">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}