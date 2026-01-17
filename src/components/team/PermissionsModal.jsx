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
import { DollarSign, ShoppingCart, Package, CheckCircle2, XCircle, Filter } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
  const [originalPermissions, setOriginalPermissions] = useState({});
  const [filterMode, setFilterMode] = useState('all');

  useEffect(() => {
    if (member?.permissions) {
      setPermissions(member.permissions);
      setOriginalPermissions(member.permissions);
    }
  }, [member]);

  if (!member) return null;

  const handleToggle = (key) => {
    setPermissions({ ...permissions, [key]: !permissions[key] });
  };

  const handleSubmit = () => {
    onUpdate(member.id, permissions);
    setOriginalPermissions(permissions);
  };

  const hasChanges = JSON.stringify(permissions) !== JSON.stringify(originalPermissions);

  const getTotalCounts = () => {
    const granted = Object.values(permissions).filter(Boolean).length;
    const restricted = Object.values(permissions).length - granted;
    return { granted, restricted };
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

  const counts = getTotalCounts();

  const filteredGroups = permissionGroups.map(group => ({
    ...group,
    permissions: group.permissions.filter(perm => {
      if (filterMode === 'granted') return permissions[perm.key];
      if (filterMode === 'restricted') return !permissions[perm.key];
      return true;
    })
  })).filter(group => group.permissions.length > 0);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[650px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Permissions</DialogTitle>
          <p className="text-sm text-slate-500 mt-2">
            Configure access for <strong>{member.user_email}</strong>
          </p>
        </DialogHeader>

        {/* Summary Bar */}
        <div className="bg-gradient-to-r from-indigo-50 to-violet-50 rounded-xl p-4 border border-indigo-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-sm font-semibold text-slate-900">
                  Granted: <span className="text-green-600">{counts.granted}</span>
                </span>
              </div>
              <div className="w-px h-6 bg-slate-300" />
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-slate-400" />
                <span className="text-sm font-semibold text-slate-900">
                  Restricted: <span className="text-slate-600">{counts.restricted}</span>
                </span>
              </div>
            </div>
            {hasChanges && (
              <Badge className="bg-amber-100 text-amber-700 border-amber-300">
                Unsaved Changes
              </Badge>
            )}
          </div>
        </div>

        {/* Filter Tabs */}
        <Tabs value={filterMode} onValueChange={setFilterMode}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="all" className="text-xs">
              All ({Object.keys(permissions).length})
            </TabsTrigger>
            <TabsTrigger value="granted" className="text-xs">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Granted ({counts.granted})
            </TabsTrigger>
            <TabsTrigger value="restricted" className="text-xs">
              <XCircle className="w-3 h-3 mr-1" />
              Restricted ({counts.restricted})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="space-y-6 py-2">
          {filteredGroups.length === 0 ? (
            <div className="text-center py-8">
              <Filter className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-500">
                No permissions in this category
              </p>
            </div>
          ) : (
            filteredGroups.map((group) => (
            <div key={group.title} className="space-y-4">
              <div className="flex items-center gap-3 pb-2 border-b border-slate-100">
                <div className={`p-2 rounded-lg ${group.iconBg}`}>
                  <group.icon className={`w-5 h-5 ${group.iconColor}`} />
                </div>
                <h3 className="font-semibold text-slate-900">{group.title}</h3>
              </div>
              
              <div className="space-y-3 pl-4">
                {group.permissions.map((perm) => {
                  const isGranted = permissions[perm.key];
                  return (
                    <div 
                      key={perm.key} 
                      className={`rounded-lg p-3 transition-colors ${
                        isGranted 
                          ? 'bg-green-50 border border-green-200' 
                          : 'bg-slate-50 border border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Label htmlFor={perm.key} className="text-sm font-medium text-slate-900">
                              {perm.label}
                            </Label>
                            {isGranted ? (
                              <Badge className="bg-green-100 text-green-700 border-green-300 flex items-center gap-1 text-xs">
                                <CheckCircle2 className="w-3 h-3" />
                                Access Granted
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-300 flex items-center gap-1 text-xs">
                                <XCircle className="w-3 h-3" />
                                Access Restricted
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-slate-600">{perm.description}</p>
                        </div>
                        <Switch
                          id={perm.key}
                          checked={isGranted}
                          onCheckedChange={() => handleToggle(perm.key)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={!hasChanges}
            className={hasChanges ? 'bg-indigo-600 hover:bg-indigo-700' : ''}
          >
            {hasChanges ? 'Save Changes' : 'No Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}