import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { WORKSPACE_MODULES } from '@/components/shared/modulesConfig';
import { Building2, Loader2 } from 'lucide-react';

export default function AssignWorkspacesModal({ open, onClose, userEmail }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [role, setRole] = useState('staff');
  const [loading, setLoading] = useState(false);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      loadWorkspaces();
      initializePermissions();
    }
  }, [open]);

  const loadWorkspaces = async () => {
    try {
      const allWorkspaces = await base44.asServiceRole.entities.Tenant.filter({});
      setWorkspaces(allWorkspaces.filter(w => !w.deleted_at));
    } catch (error) {
      console.error('Load workspaces error:', error);
    } finally {
      setLoadingWorkspaces(false);
    }
  };

  const initializePermissions = () => {
    const defaultPerms = {};
    WORKSPACE_MODULES.forEach(module => {
      if (module.hasPermissions) {
        defaultPerms[module.key] = {
          view: module.key === 'dashboard',
          edit: false
        };
      }
    });
    setPermissions(defaultPerms);
  };

  const handleToggleView = (moduleKey) => {
    setPermissions(prev => {
      const newViewValue = !prev[moduleKey]?.view;
      return {
        ...prev,
        [moduleKey]: {
          view: newViewValue,
          edit: newViewValue ? prev[moduleKey]?.edit || false : false
        }
      };
    });
  };

  const handleToggleEdit = (moduleKey) => {
    setPermissions(prev => ({
      ...prev,
      [moduleKey]: {
        ...prev[moduleKey],
        edit: !prev[moduleKey]?.edit
      }
    }));
  };

  const handleAssign = async () => {
    if (!selectedWorkspace) {
      toast({
        title: 'Select Workspace',
        description: 'Please select a workspace first',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);
    try {
      const response = await base44.functions.invoke('assignUserToWorkspace', {
        email: userEmail,
        workspace_id: selectedWorkspace,
        role,
        permissions
      });

      if (response.data.success) {
        toast({
          title: 'Success',
          description: response.data.message
        });
        onClose(true); // Pass true to indicate success
      } else {
        toast({
          title: 'Error',
          description: response.data.error || 'Failed to assign workspace',
          variant: 'destructive'
        });
      }
    } catch (error) {
      console.error('Assign workspace error:', error);
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to assign workspace',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose(false)}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Assign Workspaces to {userEmail}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Workspace Selection */}
          <div className="space-y-2">
            <Label>Select Workspace</Label>
            {loadingWorkspaces ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading workspaces...
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {workspaces.map(workspace => (
                  <button
                    key={workspace.id}
                    onClick={() => setSelectedWorkspace(workspace.id)}
                    className={`
                      p-4 rounded-lg border-2 text-left transition-colors
                      ${selectedWorkspace === workspace.id 
                        ? 'border-indigo-600 bg-indigo-50' 
                        : 'border-slate-200 hover:border-slate-300'}
                    `}
                  >
                    <p className="font-medium text-slate-900">{workspace.name}</p>
                    <p className="text-sm text-slate-600">{workspace.slug}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Role Selection */}
          <div className="space-y-2">
            <Label>Role</Label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full p-2 border rounded-lg"
            >
              <option value="staff">Staff (Limited Access)</option>
              <option value="manager">Manager (Extended Access)</option>
              <option value="admin">Admin (Full Access)</option>
            </select>
          </div>

          {/* Permissions */}
          <div className="space-y-3">
            <Label>Permissions</Label>
            <div className="border rounded-lg divide-y">
              {WORKSPACE_MODULES.filter(m => m.hasPermissions).map(module => (
                <div key={module.key} className="p-3 flex items-center justify-between">
                  <span className="text-sm font-medium">{module.label}</span>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">View</Label>
                      <Switch
                        checked={permissions[module.key]?.view || false}
                        onCheckedChange={() => handleToggleView(module.key)}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">Edit</Label>
                      <Switch
                        checked={permissions[module.key]?.edit || false}
                        onCheckedChange={() => handleToggleEdit(module.key)}
                        disabled={!permissions[module.key]?.view}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleAssign} disabled={loading || !selectedWorkspace}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Assigning...
              </>
            ) : (
              'Assign Workspace'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}