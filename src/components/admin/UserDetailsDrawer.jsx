import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Building2, Trash2, Ban, ShieldOff, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
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

export default function UserDetailsDrawer({ 
  user, 
  open, 
  onClose, 
  memberships, 
  workspaces, 
  onRefresh,
  ownerEmail 
}) {
  const { toast } = useToast();
  const [processing, setProcessing] = useState(false);
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRemoveAllConfirm, setShowRemoveAllConfirm] = useState(false);
  const [removingMembership, setRemovingMembership] = useState(null);

  const isOwner = user.email === ownerEmail;

  const getWorkspaceName = (tenantId) => {
    const workspace = workspaces.find(w => w.id === tenantId);
    return workspace?.name || 'Unknown Workspace';
  };

  const handleRemoveMembership = async (membership) => {
    if (isOwner) {
      toast({
        title: 'Cannot remove owner',
        description: 'You cannot remove your own workspace membership',
        variant: 'destructive'
      });
      return;
    }

    try {
      setRemovingMembership(membership.id);

      const response = await base44.functions.invoke('manageUserAccess', {
        action: 'remove_membership',
        user_id: user.id,
        membership_id: membership.id,
        workspace_id: membership.tenant_id
      });

      if (response.data.success) {
        toast({
          title: 'Membership removed',
          description: `${user.email} removed from ${getWorkspaceName(membership.tenant_id)}`
        });
        
        // Log audit
        await base44.entities.AuditLog.create({
          action: 'membership_removed',
          entity_type: 'Membership',
          entity_id: membership.id,
          user_email: ownerEmail,
          metadata: {
            target_email: user.email,
            workspace_id: membership.tenant_id,
            workspace_name: getWorkspaceName(membership.tenant_id)
          }
        });

        onRefresh();
      } else {
        throw new Error(response.data.error || 'Failed to remove membership');
      }
    } catch (error) {
      toast({
        title: 'Failed to remove membership',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setRemovingMembership(null);
    }
  };

  const handleDisableUser = async () => {
    if (isOwner) {
      toast({
        title: 'Cannot disable owner',
        description: 'You cannot disable yourself',
        variant: 'destructive'
      });
      return;
    }

    try {
      setProcessing(true);

      const response = await base44.functions.invoke('manageUserAccess', {
        action: 'disable_user',
        user_id: user.id
      });

      if (response.data.success) {
        toast({
          title: 'User disabled',
          description: `${user.email} has been disabled and cannot log in`
        });

        // Log audit
        await base44.entities.AuditLog.create({
          action: 'user_disabled',
          entity_type: 'User',
          entity_id: user.id,
          user_email: ownerEmail,
          metadata: {
            target_email: user.email
          }
        });

        setShowDisableConfirm(false);
        onRefresh();
      } else {
        throw new Error(response.data.error || 'Failed to disable user');
      }
    } catch (error) {
      toast({
        title: 'Failed to disable user',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteUser = async () => {
    if (isOwner) {
      toast({
        title: 'Cannot delete owner',
        description: 'You cannot delete yourself',
        variant: 'destructive'
      });
      return;
    }

    try {
      setProcessing(true);

      const response = await base44.functions.invoke('manageUserAccess', {
        action: 'delete_user',
        user_id: user.id
      });

      if (response.data.success) {
        toast({
          title: 'User deleted',
          description: `${user.email} has been soft-deleted`
        });

        // Log audit
        await base44.entities.AuditLog.create({
          action: 'user_deleted',
          entity_type: 'User',
          entity_id: user.id,
          user_email: ownerEmail,
          metadata: {
            target_email: user.email
          }
        });

        setShowDeleteConfirm(false);
        onRefresh();
      } else {
        throw new Error(response.data.error || 'Failed to delete user');
      }
    } catch (error) {
      toast({
        title: 'Failed to delete user',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleRemoveAllAccess = async () => {
    if (isOwner) {
      toast({
        title: 'Cannot remove owner access',
        description: 'You cannot remove your own workspace access',
        variant: 'destructive'
      });
      return;
    }

    try {
      setProcessing(true);

      const response = await base44.functions.invoke('manageUserAccess', {
        action: 'remove_all_memberships',
        user_id: user.id
      });

      if (response.data.success) {
        toast({
          title: 'All access removed',
          description: `Removed ${response.data.memberships_removed} workspace memberships`
        });

        // Log audit
        await base44.entities.AuditLog.create({
          action: 'all_memberships_removed',
          entity_type: 'User',
          entity_id: user.id,
          user_email: ownerEmail,
          metadata: {
            target_email: user.email,
            memberships_removed: response.data.memberships_removed
          }
        });

        setShowRemoveAllConfirm(false);
        onRefresh();
      } else {
        throw new Error(response.data.error || 'Failed to remove all access');
      }
    } catch (error) {
      toast({
        title: 'Failed to remove all access',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>User Details</SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {/* User Info */}
            <div className="space-y-3">
              <div>
                <p className="text-sm text-slate-500">Name</p>
                <p className="font-medium text-slate-900">{user.full_name || 'N/A'}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Email</p>
                <p className="font-medium text-slate-900">{user.email}</p>
                {isOwner && (
                  <Badge variant="outline" className="mt-1 bg-purple-50 text-purple-700 border-purple-200">
                    App Owner (Cannot be modified)
                  </Badge>
                )}
              </div>
              <div>
                <p className="text-sm text-slate-500">Platform Role</p>
                <Badge variant={user.role === 'admin' ? 'destructive' : 'secondary'}>
                  {user.role || 'user'}
                </Badge>
              </div>
              <div>
                <p className="text-sm text-slate-500">Account Status</p>
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                  Active
                </Badge>
              </div>
            </div>

            {/* Workspace Memberships */}
            <div>
              <h3 className="font-semibold text-slate-900 mb-3">
                Workspace Memberships ({memberships.length})
              </h3>
              {memberships.length === 0 ? (
                <div className="text-center py-6 bg-slate-50 rounded-lg border border-slate-200">
                  <ShieldOff className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm text-slate-600">No workspace access</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {memberships.map(membership => (
                    <div 
                      key={membership.id} 
                      className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <Building2 className="w-5 h-5 text-slate-400 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-slate-900 truncate">
                            {getWorkspaceName(membership.tenant_id)}
                          </p>
                          <p className="text-xs text-slate-500">
                            Role: {membership.role}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveMembership(membership)}
                        disabled={isOwner || removingMembership === membership.id}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        {removingMembership === membership.id ? (
                          'Removing...'
                        ) : (
                          <>
                            <Trash2 className="w-4 h-4 mr-1" />
                            Remove
                          </>
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="pt-6 border-t space-y-3">
              <Button
                variant="outline"
                className="w-full justify-start text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => setShowRemoveAllConfirm(true)}
                disabled={isOwner || memberships.length === 0 || processing}
              >
                <ShieldOff className="w-4 h-4 mr-2" />
                Remove All Workspace Access
              </Button>
              
              <Button
                variant="outline"
                className="w-full justify-start text-amber-600 border-amber-200 hover:bg-amber-50"
                onClick={() => setShowDisableConfirm(true)}
                disabled={isOwner || processing}
              >
                <Ban className="w-4 h-4 mr-2" />
                Disable User (Block Login)
              </Button>
              
              <Button
                variant="outline"
                className="w-full justify-start text-red-600 border-red-300 hover:bg-red-50"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isOwner || processing}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete User (Soft Delete)
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Disable Confirmation */}
      <AlertDialog open={showDisableConfirm} onOpenChange={setShowDisableConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable User?</AlertDialogTitle>
            <AlertDialogDescription>
              <div className="space-y-3">
                <p>
                  This will prevent <strong>{user.email}</strong> from logging in.
                </p>
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-amber-800">
                      <p className="font-medium">Important:</p>
                      <ul className="list-disc list-inside mt-1 space-y-1">
                        <li>User cannot log in</li>
                        <li>Workspace memberships remain intact</li>
                        <li>User can be re-enabled later</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={processing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisableUser}
              disabled={processing}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {processing ? 'Disabling...' : 'Disable User'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User?</AlertDialogTitle>
            <AlertDialogDescription>
              <div className="space-y-3">
                <p>
                  This will soft-delete <strong>{user.email}</strong>.
                </p>
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-red-800">
                      <p className="font-medium">Important:</p>
                      <ul className="list-disc list-inside mt-1 space-y-1">
                        <li>User account marked as deleted</li>
                        <li>Cannot log in</li>
                        <li>Workspaces are NOT deleted</li>
                        <li>This action can be reversed</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={processing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              disabled={processing}
              className="bg-red-600 hover:bg-red-700"
            >
              {processing ? 'Deleting...' : 'Delete User'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove All Access Confirmation */}
      <AlertDialog open={showRemoveAllConfirm} onOpenChange={setShowRemoveAllConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove All Workspace Access?</AlertDialogTitle>
            <AlertDialogDescription>
              <div className="space-y-3">
                <p>
                  This will remove <strong>{user.email}</strong> from all {memberships.length} workspace{memberships.length !== 1 ? 's' : ''}.
                </p>
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-amber-800">
                      <p className="font-medium">Important:</p>
                      <ul className="list-disc list-inside mt-1 space-y-1">
                        <li>User will have no workspace access</li>
                        <li>User account remains active</li>
                        <li>Workspaces are NOT deleted</li>
                        <li>No auto-creation will occur</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={processing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveAllAccess}
              disabled={processing}
              className="bg-red-600 hover:bg-red-700"
            >
              {processing ? 'Removing...' : 'Remove All Access'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}