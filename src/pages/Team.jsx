import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { Users, Plus, Shield, Trash2, Settings, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import InviteUserModal from '@/components/team/InviteUserModal';
import PermissionsModal from '@/components/team/PermissionsModal';
import { TableSkeleton } from '@/components/ui/LoadingSkeleton';
import EmptyState from '@/components/ui/EmptyState';

export default function TeamPage() {
  const { tenantId, isOwner, user } = useTenant();
  const { toast } = useToast();
  
  const [members, setMembers] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [memberToDelete, setMemberToDelete] = useState(null);

  useEffect(() => {
    if (tenantId) loadData();
  }, [tenantId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const membersData = await base44.entities.Membership.filter({ tenant_id: tenantId });
      
      // Fetch user details for each member
      const userIds = membersData.map(m => m.user_id);
      const usersData = await base44.entities.User.filter({ 
        id: { $in: userIds } 
      });
      
      setMembers(membersData);
      setUsers(usersData);
    } catch (error) {
      toast({
        title: 'Error loading team',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleInviteUser = async (email, role, permissions) => {
    try {
      // Invite user to the app
      await base44.users.inviteUser(email, 'user');
      
      // Check if user already exists
      const existingUsers = await base44.entities.User.filter({ email });
      let userId = existingUsers[0]?.id;
      
      if (!userId) {
        // If user doesn't exist yet, create a placeholder membership
        // The actual user will be linked when they accept the invitation
        await base44.entities.Membership.create({
          tenant_id: tenantId,
          user_id: 'pending',
          user_email: email,
          role,
          permissions
        });
      } else {
        // Check if membership already exists
        const existing = members.find(m => m.user_email === email);
        if (existing) {
          toast({
            title: 'User already in workspace',
            description: `${email} is already a member of this workspace`,
            variant: 'destructive'
          });
          return;
        }
        
        await base44.entities.Membership.create({
          tenant_id: tenantId,
          user_id: userId,
          user_email: email,
          role,
          permissions
        });
      }
      
      toast({
        title: 'User invited',
        description: `Invitation sent to ${email}`
      });
      
      loadData();
      setShowInviteModal(false);
    } catch (error) {
      toast({
        title: 'Error inviting user',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleUpdatePermissions = async (memberId, permissions) => {
    try {
      await base44.entities.Membership.update(memberId, { permissions });
      
      toast({
        title: 'Permissions updated',
        description: 'User permissions have been saved'
      });
      
      loadData();
      setShowPermissionsModal(false);
    } catch (error) {
      toast({
        title: 'Error updating permissions',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleDeleteMember = async () => {
    try {
      if (memberToDelete.role === 'owner') {
        toast({
          title: 'Cannot remove owner',
          description: 'The workspace owner cannot be removed',
          variant: 'destructive'
        });
        return;
      }
      
      await base44.entities.Membership.delete(memberToDelete.id);
      
      toast({
        title: 'Member removed',
        description: 'User has been removed from the workspace'
      });
      
      loadData();
      setShowDeleteDialog(false);
      setMemberToDelete(null);
    } catch (error) {
      toast({
        title: 'Error removing member',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const getRoleBadge = (role) => {
    const config = {
      owner: { color: 'bg-purple-100 text-purple-700', label: 'Owner' },
      admin: { color: 'bg-indigo-100 text-indigo-700', label: 'Admin' },
      manager: { color: 'bg-blue-100 text-blue-700', label: 'Manager' },
      staff: { color: 'bg-slate-100 text-slate-700', label: 'Staff' }
    };
    const { color, label } = config[role] || config.staff;
    return <Badge className={color}>{label}</Badge>;
  };

  const getUserName = (member) => {
    const userRecord = users.find(u => u.id === member.user_id);
    return userRecord?.full_name || member.user_email;
  };

  if (!isOwner) {
    return (
      <div className="space-y-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-center">
          <Shield className="w-12 h-12 text-yellow-600 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-yellow-900 mb-2">Access Restricted</h2>
          <p className="text-yellow-700">Only workspace owners can manage team members and permissions.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Team Management</h1>
          <p className="text-slate-500 mt-1">Manage workspace members and permissions</p>
        </div>
        
        <Button 
          onClick={() => setShowInviteModal(true)}
          className="bg-indigo-600 hover:bg-indigo-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          Invite User
        </Button>
      </div>

      {/* Team Table */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <TableSkeleton rows={5} cols={4} />
        </div>
      ) : members.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100">
          <EmptyState
            icon={Users}
            title="No team members yet"
            description="Invite users to collaborate in your workspace"
            actionLabel="Invite User"
            onAction={() => setShowInviteModal(true)}
          />
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="py-4 px-6 text-left text-xs font-semibold text-slate-500 uppercase">User</th>
                  <th className="py-4 px-6 text-left text-xs font-semibold text-slate-500 uppercase">Email</th>
                  <th className="py-4 px-6 text-left text-xs font-semibold text-slate-500 uppercase">Role</th>
                  <th className="py-4 px-6 text-right text-xs font-semibold text-slate-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {members.map((member) => (
                  <tr key={member.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 flex items-center justify-center text-white font-semibold">
                          {getUserName(member).charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-slate-900">{getUserName(member)}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-slate-600">{member.user_email}</td>
                    <td className="py-4 px-6">{getRoleBadge(member.role)}</td>
                    <td className="py-4 px-6">
                      <div className="flex items-center justify-end gap-2">
                        {member.role !== 'owner' && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSelectedMember(member);
                                setShowPermissionsModal(true);
                              }}
                            >
                              <Settings className="w-4 h-4 mr-2" />
                              Permissions
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setMemberToDelete(member);
                                setShowDeleteDialog(true);
                              }}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                        {member.role === 'owner' && (
                          <Badge variant="outline" className="text-xs">Full Access</Badge>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      <InviteUserModal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        onInvite={handleInviteUser}
      />

      <PermissionsModal
        open={showPermissionsModal}
        onClose={() => {
          setShowPermissionsModal(false);
          setSelectedMember(null);
        }}
        member={selectedMember}
        onUpdate={handleUpdatePermissions}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Team Member?</AlertDialogTitle>
            <AlertDialogDescription>
              {memberToDelete && (
                <>
                  Are you sure you want to remove <strong>{memberToDelete.user_email}</strong> from the workspace? 
                  They will lose all access immediately.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setMemberToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteMember}
              className="bg-red-600 hover:bg-red-700"
            >
              Remove Member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}