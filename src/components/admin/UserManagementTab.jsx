import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Users, Eye, Trash2, Ban, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import UserDetailsDrawer from './UserDetailsDrawer';
import RefreshButton from '@/components/shared/RefreshButton';

export default function UserManagementTab({ allUsers, memberships, workspaces, onRefresh, ownerEmail }) {
  const { toast } = useToast();
  const [selectedUser, setSelectedUser] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const getUserWorkspaceCount = (userId) => {
    return memberships.filter(m => m.user_id === userId).length;
  };

  const handleViewUser = (user) => {
    setSelectedUser(user);
    setDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setDrawerOpen(false);
    setSelectedUser(null);
  };

  const handleRefreshAfterAction = () => {
    handleCloseDrawer();
    onRefresh();
  };

  return (
    <>
      <div className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center gap-3">
              <Users className="w-8 h-8 text-indigo-600" />
              <div>
                <p className="text-sm text-slate-500">Total Users</p>
                <p className="text-2xl font-bold text-slate-900">
                  {allUsers.filter(u => u.deleted !== true).length}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center gap-3">
              <ShieldOff className="w-8 h-8 text-amber-600" />
              <div>
                <p className="text-sm text-slate-500">No Workspace Access</p>
                <p className="text-2xl font-bold text-slate-900">
                  {allUsers.filter(u => getUserWorkspaceCount(u.id) === 0).length}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center gap-3">
              <Ban className="w-8 h-8 text-red-600" />
              <div>
                <p className="text-sm text-slate-500">Platform Admins</p>
                <p className="text-2xl font-bold text-slate-900">
                  {allUsers.filter(u => u.role === 'admin').length}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Users Table */}
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="p-6 border-b border-slate-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">All Users</h2>
              <RefreshButton onRefresh={onRefresh} />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-slate-600">Name</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-slate-600">Email</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-slate-600">Role</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-slate-600">Total Workspaces</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-slate-600">Created At</th>
                  <th className="text-right py-3 px-6 text-xs font-semibold text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {allUsers.map(user => {
                  const workspaceCount = getUserWorkspaceCount(user.id);
                  const isOwner = user.email === ownerEmail;
                  
                  return (
                    <tr key={user.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-4 px-6">
                        <p className="font-medium text-slate-900">{user.full_name || 'N/A'}</p>
                      </td>
                      <td className="py-4 px-6">
                        <p className="text-sm text-slate-600">{user.email}</p>
                        {isOwner && (
                          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full mt-1">
                            App Owner
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-6">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          user.role === 'admin' 
                            ? 'bg-red-100 text-red-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {user.role || 'user'}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-slate-400" />
                          <span className="text-sm text-slate-600">{workspaceCount}</span>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-sm text-slate-600">
                        {new Date(user.created_date).toLocaleDateString()}
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewUser(user)}
                            className="text-indigo-600 hover:text-indigo-700"
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            View
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
      </div>

      {/* User Details Drawer */}
      {selectedUser && (
        <UserDetailsDrawer
          user={selectedUser}
          open={drawerOpen}
          onClose={handleCloseDrawer}
          memberships={memberships.filter(m => m.user_id === selectedUser.id)}
          workspaces={workspaces}
          onRefresh={handleRefreshAfterAction}
          ownerEmail={ownerEmail}
        />
      )}
    </>
  );
}