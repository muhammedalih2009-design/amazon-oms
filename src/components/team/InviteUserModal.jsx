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
import { Mail, Eye, Edit } from 'lucide-react';

const ROLE_PRESETS = {
  admin: {
    dashboard: { view: true, edit: true },
    skus: { view: true, edit: true },
    orders: { view: true, edit: true },
    purchases: { view: true, edit: true },
    returns: { view: true, edit: true },
    settlement: { view: true, edit: true },
    suppliers: { view: true, edit: true }
  },
  manager: {
    dashboard: { view: true, edit: true },
    skus: { view: true, edit: true },
    orders: { view: true, edit: true },
    purchases: { view: true, edit: true },
    returns: { view: true, edit: true },
    settlement: { view: true, edit: false },
    suppliers: { view: true, edit: true }
  },
  staff: {
    dashboard: { view: true, edit: false },
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
  { key: 'skus', name: 'SKUs / Products' },
  { key: 'orders', name: 'Orders' },
  { key: 'purchases', name: 'Purchases' },
  { key: 'returns', name: 'Returns' },
  { key: 'settlement', name: 'Settlement' },
  { key: 'suppliers', name: 'Suppliers' }
];

export default function InviteUserModal({ open, onClose, onInvite }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('staff');
  const [permissions, setPermissions] = useState(ROLE_PRESETS.staff);

  useEffect(() => {
    // Apply role preset when role changes
    setPermissions(ROLE_PRESETS[role]);
  }, [role]);

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

  const handleSubmit = (e) => {
    e.preventDefault();
    onInvite(email, role, permissions);
    setEmail('');
    setRole('staff');
    setPermissions(ROLE_PRESETS.staff);
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
                />
              </div>
            </div>

            {/* Role Select */}
            <div>
              <Label htmlFor="role">Role *</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin - Full access to all modules</SelectItem>
                  <SelectItem value="manager">Manager - Can view/edit most data</SelectItem>
                  <SelectItem value="staff">Staff - Limited read access</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Permissions Grid */}
            <div>
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
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Send Invitation</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}