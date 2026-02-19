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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Mail, Eye, Edit, X, AlertCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';

const ROLE_PRESETS = {
  admin: {
    dashboard: { view: true, edit: true },
    tasks: { view: true, edit: true },
    skus: { view: true, edit: true },
    orders: { view: true, edit: true },
    purchases: { view: true, edit: true },
    returns: { view: true, edit: true },
    settlement: { view: true, edit: true },
    suppliers: { view: true, edit: true }
  },
  manager: {
    dashboard: { view: true, edit: true },
    tasks: { view: true, edit: true },
    skus: { view: true, edit: true },
    orders: { view: true, edit: true },
    purchases: { view: true, edit: true },
    returns: { view: true, edit: true },
    settlement: { view: true, edit: false },
    suppliers: { view: true, edit: true }
  },
  staff: {
    dashboard: { view: true, edit: false },
    tasks: { view: true, edit: false },
    skus: { view: true, edit: false },
    orders: { view: true, edit: false },
    purchases: { view: false, edit: false },
    returns: { view: false, edit: false },
    settlement: { view: false, edit: false },
    suppliers: { view: false, edit: false }
  }
};

const PAGES = [
  { key: 'dashboard', name: 'Dashboard' },
  { key: 'tasks', name: 'Tasks' },
  { key: 'skus', name: 'SKUs / Products' },
  { key: 'orders', name: 'Orders' },
  { key: 'purchases', name: 'Purchases' },
  { key: 'returns', name: 'Returns' },
  { key: 'settlement', name: 'Settlement' },
  { key: 'suppliers', name: 'Suppliers' }
];

export default function InviteUserModal({ open, onClose, onInvite, workspaceId }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [permissions, setPermissions] = useState(ROLE_PRESETS.staff);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingInvites, setPendingInvites] = useState([]);
  const { toast } = useToast();

  useEffect(() => {
    // Apply role preset when role changes
    const preset = ROLE_PRESETS[role] || ROLE_PRESETS.staff;
    setPermissions(preset);
  }, [role]);

  useEffect(() => {
    if (open && workspaceId) {
      loadPendingInvites();
    }
  }, [open, workspaceId]);

  const loadPendingInvites = async () => {
    try {
      const invites = await base44.entities.WorkspaceInvite.filter({
        workspace_id: workspaceId,
        status: 'pending'
      });
      setPendingInvites(invites);
    } catch (error) {
      console.error('Error loading invites:', error);
    }
  };

  const handleToggleView = (pageKey) => {
    setPermissions(prev => {
      const newPerms = { ...prev };
      const newViewValue = !prev[pageKey].view;
      
      newPerms[pageKey] = {
        view: newViewValue,
        edit: newViewValue ? prev[pageKey].edit : false // If view OFF, edit must be OFF
      };
      
      return newPerms;
    });
  };

  const handleToggleEdit = (pageKey) => {
    setPermissions(prev => {
      const newPerms = { ...prev };
      const newEditValue = !prev[pageKey].edit;
      
      newPerms[pageKey] = {
        view: newEditValue ? true : prev[pageKey].view, // If edit ON, view must be ON
        edit: newEditValue
      };
      
      return newPerms;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return; // Prevent double-submit
    
    setSubmitting(true);
    setLoading(true);

    try {
      const { data } = await base44.functions.invoke('inviteWorkspaceMember', {
        workspace_id: workspaceId,
        email: email.toLowerCase().trim(),
        role
      });

      if (data.ok) {
        if (data.mode === 'invite_created' && data.invite_link) {
          // Show invite link with copy button
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
                    toast({ title: 'Link copied!' });
                  }}
                  className="w-full mt-2"
                >
                  Copy Invite Link
                </Button>
              </div>
            ),
            duration: 10000,
          });
        } else {
          toast({
            title: data.mode === 'member_added' ? 'Member Added' : 'Invite Sent',
            description: data.message,
          });
        }

        setEmail('');
        setRole('member');
        setPermissions(ROLE_PRESETS.staff);
        
        if (data.mode === 'invite_created') {
          await loadPendingInvites();
        }
        
        if (onInvite) {
          onInvite();
        }
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

  const handleRevokeInvite = async (inviteId) => {
    try {
      await base44.functions.invoke('revokeWorkspaceInvite', {
        invite_id: inviteId
      });

      toast({
        title: 'Invite Revoked',
        description: 'The invitation has been cancelled',
      });

      await loadPendingInvites();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.response?.data?.error || error.message,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invite Team Member</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit}>
          <div className="space-y-6 py-4">
            {/* Email Input */}
            <div>
              <Label htmlFor="email">Email Address *</Label>
              <div className="relative mt-2">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="pl-10"
                  required
                  disabled={loading}
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Enter any email address. If the user doesn't exist, they'll receive an invite.
              </p>
            </div>

            {/* Role Select */}
            <div>
              <Label htmlFor="role">Role *</Label>
              <Select value={role} onValueChange={setRole} disabled={loading}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Owner - Full control</SelectItem>
                  <SelectItem value="admin">Admin - Full access to all modules</SelectItem>
                  <SelectItem value="member">Member - Standard access</SelectItem>
                  <SelectItem value="viewer">Viewer - Read-only access</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Pending Invites */}
            {pendingInvites.length > 0 && (
              <div>
                <Label className="mb-2 block">Pending Invites ({pendingInvites.length})</Label>
                <div className="space-y-2 max-h-64 overflow-y-auto border rounded-lg p-3 bg-slate-50">
                  {pendingInvites.map((invite) => {
                    const inviteLink = `https://amazonoms.base44.app/AcceptInvite?token=${invite.token}`;
                    return (
                      <div
                        key={invite.id}
                        className="flex items-start justify-between p-3 bg-white rounded border"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{invite.invited_email}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">
                              {invite.role}
                          </Badge>
                              <Badge variant="secondary" className="text-xs">
                                Pending
                              </Badge>
                            </div>
                            <p className="text-xs text-slate-500 mt-1">
                              Expires: {new Date(invite.expires_at).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 ml-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                navigator.clipboard.writeText(inviteLink);
                                toast({ title: 'Invite link copied!' });
                              }}
                              className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 text-xs"
                            >
                              Copy Link
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRevokeInvite(invite.id)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-blue-700 space-y-1">
                  <p><strong>How Invites Work:</strong></p>
                  <p>• Copy and share the invite link with the user</p>
                  <p>• They'll join THIS workspace only (strict isolation)</p>
                  <p>• Links expire in 7 days</p>
                </div>
              </div>
            </div>

            {/* Permissions Grid - Hidden for now, simplified */}
            <div style={{ display: 'none' }}>
              <Label className="mb-3 block">Page-Level Permissions</Label>
              <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-100 border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4 text-left text-xs font-semibold text-slate-600 uppercase">
                        Page
                      </th>
                      <th className="py-3 px-4 text-center text-xs font-semibold text-slate-600 uppercase w-24">
                        <div className="flex items-center justify-center gap-1">
                          <Eye className="w-3 h-3" />
                          View
                        </div>
                      </th>
                      <th className="py-3 px-4 text-center text-xs font-semibold text-slate-600 uppercase w-24">
                        <div className="flex items-center justify-center gap-1">
                          <Edit className="w-3 h-3" />
                          Edit
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {PAGES.map((page) => (
                      <tr key={page.key} className="hover:bg-slate-100/50 transition-colors">
                        <td className="py-3 px-4 text-sm font-medium text-slate-900">
                          {page.name}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex justify-center">
                            <Switch
                              checked={permissions[page.key]?.view || false}
                              onCheckedChange={() => handleToggleView(page.key)}
                            />
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex justify-center">
                            <Switch
                              checked={permissions[page.key]?.edit || false}
                              onCheckedChange={() => handleToggleEdit(page.key)}
                              disabled={!permissions[page.key]?.view}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                💡 <strong>Tip:</strong> Edit access automatically enables View. Disabling View removes Edit.
              </p>
            </div>

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-blue-900 mb-2">Role Presets:</h4>
              <div className="text-xs text-blue-700 space-y-1">
                <p>• <strong>Admin:</strong> Full access (View + Edit) to all modules</p>
                <p>• <strong>Manager:</strong> View/Edit most modules except Settlement edit</p>
                <p>• <strong>Staff:</strong> Limited View-only access to basic modules</p>
                <p className="mt-2 text-blue-600">You can customize permissions after selecting a role</p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="bg-indigo-600 hover:bg-indigo-700">
              {loading ? 'Processing...' : 'Add / Invite Member'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}