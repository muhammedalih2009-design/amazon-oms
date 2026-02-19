import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { UserPlus, UserX, UserCheck, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

export default function AllowedUsersManager() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const { data } = await base44.functions.invoke('manageAllowedUsers', { action: 'list' });
      setUsers(data.users || []);
    } catch (error) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const addUser = async () => {
    if (!email.trim()) {
      toast({
        title: 'Error',
        description: 'Email is required',
        variant: 'destructive'
      });
      return;
    }

    try {
      setAdding(true);
      await base44.functions.invoke('manageAllowedUsers', {
        action: 'add',
        email: email.trim(),
        name: name.trim()
      });

      toast({
        title: 'Success',
        description: 'User added to allowlist'
      });

      setEmail('');
      setName('');
      loadUsers();
    } catch (error) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setAdding(false);
    }
  };

  const toggleStatus = async (user) => {
    try {
      const newStatus = user.status === 'active' ? 'disabled' : 'active';
      await base44.functions.invoke('manageAllowedUsers', {
        action: 'update_status',
        email: user.email,
        status: newStatus
      });

      toast({
        title: 'Success',
        description: `User ${newStatus === 'active' ? 'enabled' : 'disabled'}`
      });

      loadUsers();
    } catch (error) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Add User Form */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Add User to Allowlist</h3>
        <div className="flex gap-3">
          <Input
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1"
          />
          <Input
            placeholder="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1"
          />
          <Button onClick={addUser} disabled={adding}>
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Add
          </Button>
        </div>
        <p className="text-sm text-slate-600 mt-2">
          ⚠️ Adding a user here only allows login. Workspace access must be granted from Team page.
        </p>
      </Card>

      {/* Users List */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Allowed Users ({users.length})</h3>
        <div className="space-y-2">
          {users.length === 0 ? (
            <p className="text-slate-500 text-center py-8">No users in allowlist</p>
          ) : (
            users.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between p-3 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{user.email}</span>
                    {user.status === 'active' ? (
                      <Badge className="bg-green-100 text-green-800">Active</Badge>
                    ) : (
                      <Badge className="bg-red-100 text-red-800">Disabled</Badge>
                    )}
                  </div>
                  {user.name && (
                    <p className="text-sm text-slate-600">{user.name}</p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleStatus(user)}
                >
                  {user.status === 'active' ? (
                    <>
                      <UserX className="w-4 h-4 mr-1" />
                      Disable
                    </>
                  ) : (
                    <>
                      <UserCheck className="w-4 h-4 mr-1" />
                      Enable
                    </>
                  )}
                </Button>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}