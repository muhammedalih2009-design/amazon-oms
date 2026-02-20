import React, { useState, useEffect } from 'react';
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
import { Switch } from '@/components/ui/switch';
import { Mail, Eye, Edit, Shield, UserPlus, UserMinus } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { WORKSPACE_MODULES, getDefaultPermissions } from '@/components/shared/modulesConfig';

const ROLE_TEMPLATES = {
  staff: {
    label: 'Staff',
    description: 'Basic access - View only most pages',
    permissions: {
      dashboard: { view: true, edit: false },
      tasks: { view: true, edit: false },
      skus_products: { view: true, edit: false },
      orders: { view: true, edit: false },
      profitability: { view: false, edit: false },
      purchase_requests: { view: false, edit: false },
      purchases: { view: false, edit: false },
      returns: { view: false, edit: false },
      suppliers: { view: false, edit: false },
      team: { view: false, edit: false },
      backup_data: { view: false, edit: false },
      settings: { view: false, edit: false },
      member_mgmt: { can_add_members: false, can_remove_members: false }
    }
  },
  manager: {
    label: 'Manager',
    description: 'Extended access - Can edit most operational pages',
    permissions: {
      dashboard: { view: true, edit: true },
      tasks: { view: true, edit: true },
      skus_products: { view: true, edit: true },
      orders: { view: true, edit: true },
      profitability: { view: true, edit: false },
      purchase_requests: { view: true, edit: true },
      purchases: { view: true, edit: true },
      returns: { view: true, edit: true },
      suppliers: { view: true, edit: true },
      team: { view: false, edit: false },
      backup_data: { view: false, edit: false },
      settings: { view: false, edit: false },
      member_mgmt: { can_add_members: false, can_remove_members: false }
    }
  },
  admin: {
    label: 'Admin',
    description: 'Full access - Can view and edit everything',
    permissions: {
      dashboard: { view: true, edit: true },
      tasks: { view: true, edit: true },
      skus_products: { view: true, edit: true },
      orders: { view: true, edit: true },
      profitability: { view: true, edit: true },
      purchase_requests: { view: true, edit: true },
      purchases: { view: true, edit: true },
      returns: { view: true, edit: true },
      suppliers: { view: true, edit: true },
      team: { view: true, edit: true },
      backup_data: { view: true, edit: true },
      settings: { view: true, edit: true },
      member_mgmt: { can_add_members: true, can_remove_members: true }
    }
  }
};

export default function InviteUserModal({ open, onClose, onInvite, workspaceId }) {
  const [email, setEmail] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('staff');
  const [permissions, setPermissions] = useState(ROLE_TEMPLATES.staff.permissions);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      // Reset form
      setEmail('');
      setSelectedTemplate('staff');
      setPermissions(ROLE_TEMPLATES.staff.permissions);
    }
  }, [open]);

  const applyTemplate = (templateKey) => {
    setSelectedTemplate(templateKey);
    setPermissions({ ...ROLE_TEMPLATES[templateKey].permissions });
  };

  const handleToggleView = (moduleKey) => {
    setPermissions(prev => {
      const newPerms = { ...prev };
      const newViewValue = !prev[moduleKey].view;
      
      newPerms[moduleKey] = {
        view: newViewValue,
        edit: newViewValue ? prev[moduleKey].edit : false // If view OFF, edit must be OFF
      };
      
      return newPerms;
    });
  };

  const handleToggleEdit = (moduleKey) => {
    setPermissions(prev => {
      const newPerms = { ...prev };
      const newEditValue = !prev[moduleKey].edit;
      
      newPerms[moduleKey] = {
        view: newEditValue ? true : prev[moduleKey].view, // If edit ON, view must be ON
        edit: newEditValue
      };
      
      return newPerms;
    });
  };

  const handleToggleMemberMgmt = (permissionKey) => {
    setPermissions(prev => ({
      ...prev,
      member_mgmt: {
        ...prev.member_mgmt,
        [permissionKey]: !prev.member_mgmt[permissionKey]
      }
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    
    setLoading(true);

    try {
      const { data } = await base44.functions.invoke('inviteWorkspaceMemberGranular', {
        workspace_id: workspaceId,
        email: email.toLowerCase().trim(),
        role: selectedTemplate, // Use template name as role
        permissions
      });

      if (data.success) {
        if (data.mode === 'invite_created' && data.invite_link) {
          toast({
            title: 'Invite Created',
            description: (
              <div className="space-y-2">
                <p className="text-sm font-medium">Share this link with {email}:</p>
                <div className="bg-slate-100 p-2 rounded text-xs font-mono break-all">
                  {data.invite_link}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(data.invite_link);
                    toast({ title: 'Link copied to clipboard!' });
                  }}
                  className="w-full mt-2"
                >
                  Copy Invite Link
                </Button>
              </div>
            ),
            duration: 15000,
          });
        } else {
          toast({
            title: data.mode === 'member_added' ? 'Member Added' : 'Invite Created',
            description: data.message,
          });
        }

        setEmail('');
        setSelectedTemplate('staff');
        setPermissions(ROLE_TEMPLATES.staff.permissions);
        
        if (onInvite) {
          onInvite();
        }
        
        onClose();
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.response?.data?.error || error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const pageModules = WORKSPACE_MODULES.filter(m => m.hasPermissions);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Invite Team Member
          </DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit}>
          <div className="space-y-6 py-4">
            {/* Email Input */}
            <div>
              <Label htmlFor="email">Email Address *</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                className="mt-2"
                required
                disabled={loading}
              />
              <p className="text-xs text-slate-500 mt-1">
                Enter any email address. If the user doesn't exist, they'll receive an invite link.
              </p>
            </div>

            {/* Role Template Selector */}
            <div>
              <Label>Role Template (Optional Convenience)</Label>
              <p className="text-xs text-slate-500 mb-3">
                Select a template to pre-fill permissions, then customize per-page below
              </p>
              <div className="grid grid-cols-3 gap-3">
                {Object.entries(ROLE_TEMPLATES).map(([key, template]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyTemplate(key)}
                    className={`
                      p-4 rounded-lg border-2 text-left transition-colors
                      ${selectedTemplate === key 
                        ? 'border-indigo-600 bg-indigo-50' 
                        : 'border-slate-200 hover:border-slate-300'}
                    `}
                    disabled={loading}
                  >
                    <p className="font-medium text-sm">{template.label}</p>
                    <p className="text-xs text-slate-600 mt-1">{template.description}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Per-Page Permissions Table */}
            <div>
              <Label>Per-Page Permissions</Label>
              <p className="text-xs text-slate-500 mb-3">
                Customize what this member can see and edit on each page
              </p>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-4 py-3 text-sm font-medium text-slate-700">Page / Module</th>
                      <th className="text-center px-4 py-3 text-sm font-medium text-slate-700 w-24">
                        <div className="flex items-center justify-center gap-1">
                          <Eye className="w-4 h-4" />
                          View
                        </div>
                      </th>
                      <th className="text-center px-4 py-3 text-sm font-medium text-slate-700 w-24">
                        <div className="flex items-center justify-center gap-1">
                          <Edit className="w-4 h-4" />
                          Edit
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {pageModules.map(module => (
                      <tr key={module.key} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-sm font-medium">{module.label}</td>
                        <td className="px-4 py-3 text-center">
                          <Switch
                            checked={permissions[module.key]?.view || false}
                            onCheckedChange={() => handleToggleView(module.key)}
                            disabled={loading}
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Switch
                            checked={permissions[module.key]?.edit || false}
                            onCheckedChange={() => handleToggleEdit(module.key)}
                            disabled={loading || !permissions[module.key]?.view}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-amber-600 mt-2">
                ⚠️ If "Edit" is ON, "View" is automatically enabled. If "View" is OFF, "Edit" is disabled.
              </p>
            </div>

            {/* Member Management Permissions */}
            <div>
              <Label>Member Management Permissions</Label>
              <p className="text-xs text-slate-500 mb-3">
                Control whether this member can add or remove other team members (separate from Team page access)
              </p>
              <div className="border rounded-lg p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                      <UserPlus className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">Can Add Members</p>
                      <p className="text-xs text-slate-600">Allows inviting new members to workspace</p>
                    </div>
                  </div>
                  <Switch
                    checked={permissions.member_mgmt?.can_add_members || false}
                    onCheckedChange={() => handleToggleMemberMgmt('can_add_members')}
                    disabled={loading}
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                      <UserMinus className="w-5 h-5 text-red-600" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">Can Remove Members</p>
                      <p className="text-xs text-slate-600">Allows removing members with lower role levels</p>
                    </div>
                  </div>
                  <Switch
                    checked={permissions.member_mgmt?.can_remove_members || false}
                    onCheckedChange={() => handleToggleMemberMgmt('can_remove_members')}
                    disabled={loading}
                  />
                </div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mt-3">
                <div className="flex gap-2">
                  <Shield className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-amber-800">
                    <p className="font-medium mb-1">Safety Rules:</p>
                    <ul className="list-disc list-inside space-y-0.5">
                      <li>Cannot remove workspace owner (except platform admin)</li>
                      <li>Cannot remove members with equal or higher role level</li>
                      <li>Cannot remove yourself</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="bg-indigo-600 hover:bg-indigo-700">
              {loading ? 'Creating...' : 'Create Invite'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}