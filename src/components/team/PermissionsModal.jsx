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
import { CheckCircle2, XCircle, Filter, Eye, Edit } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

  const PAGES = [
    { key: 'dashboard', label: 'Dashboard', category: 'General Access' },
    { key: 'tasks', label: 'Tasks', category: 'Task Management' },
    { key: 'skus', label: 'SKUs / Products', category: 'Inventory & Suppliers' },
    { key: 'suppliers', label: 'Suppliers', category: 'Inventory & Suppliers' },
    { key: 'orders', label: 'Orders', category: 'Operations' },
    { key: 'purchases', label: 'Purchases', category: 'Operations' },
    { key: 'returns', label: 'Returns', category: 'Operations' },
    { key: 'settlement', label: 'Settlement', category: 'Financial Data' },
  ];

export default function PermissionsModal({ open, onClose, member, onUpdate }) {
  const [permissions, setPermissions] = useState({});
  const [originalPermissions, setOriginalPermissions] = useState({});
  const [filterMode, setFilterMode] = useState('all');

  useEffect(() => {
    if (member?.permissions) {
      setPermissions(member.permissions);
      setOriginalPermissions(member.permissions);
    }
  }, [member]);

  if (!member) return null;

  const handleToggleView = (pageKey) => {
    setPermissions(prev => {
      const newPerms = { ...prev };
      const newViewValue = !prev[pageKey]?.view;
      
      newPerms[pageKey] = {
        view: newViewValue,
        edit: newViewValue ? prev[pageKey]?.edit || false : false
      };
      
      return newPerms;
    });
  };

  const handleToggleEdit = (pageKey) => {
    setPermissions(prev => {
      const newPerms = { ...prev };
      const newEditValue = !prev[pageKey]?.edit;
      
      newPerms[pageKey] = {
        view: newEditValue ? true : prev[pageKey]?.view || false,
        edit: newEditValue
      };
      
      return newPerms;
    });
  };

  const handleSubmit = () => {
    onUpdate(member.id, permissions);
    setOriginalPermissions(permissions);
  };

  const hasChanges = JSON.stringify(permissions) !== JSON.stringify(originalPermissions);

  const getTotalCounts = () => {
    let granted = 0;
    let total = 0;
    
    PAGES.forEach(page => {
      const perm = permissions[page.key];
      if (perm?.view) granted++;
      if (perm?.edit) granted++;
      total += 2; // view + edit
    });
    
    return { granted, restricted: total - granted };
  };

  const counts = getTotalCounts();

  const groupedPages = PAGES.reduce((acc, page) => {
    if (!acc[page.category]) {
      acc[page.category] = [];
    }
    acc[page.category].push(page);
    return acc;
  }, {});

  const filteredCategories = Object.entries(groupedPages)
    .map(([category, pages]) => ({
      category,
      pages: pages.filter(page => {
        const perm = permissions[page.key];
        const hasAnyAccess = perm?.view || perm?.edit;
        
        if (filterMode === 'granted') return hasAnyAccess;
        if (filterMode === 'restricted') return !hasAnyAccess;
        return true;
      })
    }))
    .filter(group => group.pages.length > 0);

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
              All ({PAGES.length})
            </TabsTrigger>
            <TabsTrigger value="granted" className="text-xs">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Has Access ({filteredCategories.filter(c => filterMode === 'all' || c.pages.length > 0).length})
            </TabsTrigger>
            <TabsTrigger value="restricted" className="text-xs">
              <XCircle className="w-3 h-3 mr-1" />
              No Access
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="space-y-6 py-2">
          {filteredCategories.length === 0 ? (
            <div className="text-center py-8">
              <Filter className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-500">
                No pages in this category
              </p>
            </div>
          ) : (
            filteredCategories.map(({ category, pages }) => (
            <div key={category} className="space-y-4">
              <div className="flex items-center gap-3 pb-2 border-b border-slate-100">
                <h3 className="font-semibold text-slate-900">{category}</h3>
              </div>
              
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
                    {pages.map((page) => {
                      const perm = permissions[page.key] || { view: false, edit: false };
                      const hasAccess = perm.view || perm.edit;
                      
                      return (
                        <tr key={page.key} className={`transition-colors ${
                          hasAccess ? 'bg-green-50/50' : 'bg-white'
                        }`}>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-slate-900">{page.label}</span>
                              {hasAccess ? (
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
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div className="flex justify-center">
                              <Switch
                                checked={perm.view}
                                onCheckedChange={() => handleToggleView(page.key)}
                              />
                            </div>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div className="flex justify-center">
                              <Switch
                                checked={perm.edit}
                                onCheckedChange={() => handleToggleEdit(page.key)}
                                disabled={!perm.view}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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