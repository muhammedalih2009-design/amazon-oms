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
import { DollarSign, ShoppingCart, Package } from 'lucide-react';

export default function PermissionsModal({ open, onClose, member, onUpdate }) {
  const [permissions, setPermissions] = useState({
    view_net_revenue: false,
    view_profit: false,
    view_sku_costs: false,
    edit_orders: false,
    bulk_upload_csv: false,
    process_returns: false,
    manage_inventory: false,
    manage_purchases: false,
    manage_suppliers: false
  });

  useEffect(() => {
    if (member?.permissions) {
      setPermissions(member.permissions);
    }
  }, [member]);

  if (!member) return null;

  const handleToggle = (key) => {
    setPermissions({ ...permissions, [key]: !permissions[key] });
  };

  const handleSubmit = () => {
    onUpdate(member.id, permissions);
  };

  const permissionGroups = [
    {
      title: 'Financial Data',
      icon: DollarSign,
      iconBg: 'bg-green-100',
      iconColor: 'text-green-600',
      permissions: [
        { key: 'view_net_revenue', label: 'View Net Revenue', description: 'See order revenue and totals' },
        { key: 'view_profit', label: 'View Profit & Margins', description: 'See profit calculations and margins' },
        { key: 'view_sku_costs', label: 'View SKU Costs', description: 'See cost prices in product catalog' }
      ]
    },
    {
      title: 'Operations',
      icon: ShoppingCart,
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-600',
      permissions: [
        { key: 'edit_orders', label: 'Edit Orders', description: 'Modify and delete orders' },
        { key: 'bulk_upload_csv', label: 'Bulk Upload CSV', description: 'Import data via CSV files' },
        { key: 'process_returns', label: 'Process Returns', description: 'Handle return requests' }
      ]
    },
    {
      title: 'Inventory & Suppliers',
      icon: Package,
      iconBg: 'bg-purple-100',
      iconColor: 'text-purple-600',
      permissions: [
        { key: 'manage_inventory', label: 'Manage SKUs', description: 'Add, edit, and delete products' },
        { key: 'manage_purchases', label: 'Record Purchases', description: 'Add purchase orders' },
        { key: 'manage_suppliers', label: 'Manage Suppliers', description: 'Add and edit supplier information' }
      ]
    }
  ];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Permissions</DialogTitle>
          <p className="text-sm text-slate-500 mt-2">
            Configure access for <strong>{member.user_email}</strong>
          </p>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {permissionGroups.map((group) => (
            <div key={group.title} className="space-y-4">
              <div className="flex items-center gap-3 pb-2 border-b border-slate-100">
                <div className={`p-2 rounded-lg ${group.iconBg}`}>
                  <group.icon className={`w-5 h-5 ${group.iconColor}`} />
                </div>
                <h3 className="font-semibold text-slate-900">{group.title}</h3>
              </div>
              
              <div className="space-y-4 pl-4">
                {group.permissions.map((perm) => (
                  <div key={perm.key} className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <Label htmlFor={perm.key} className="text-sm font-medium text-slate-900">
                        {perm.label}
                      </Label>
                      <p className="text-xs text-slate-500 mt-1">{perm.description}</p>
                    </div>
                    <Switch
                      id={perm.key}
                      checked={permissions[perm.key]}
                      onCheckedChange={() => handleToggle(perm.key)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Save Permissions</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}