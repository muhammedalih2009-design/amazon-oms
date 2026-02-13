import React, { useState } from 'react';
import { useTenant } from '@/components/hooks/useTenant';
import { ChevronDown, Building2, Search, CheckCircle, Ban, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function WorkspaceSwitcher() {
  const { tenant, allWorkspaces, switchWorkspace, subscription, isSuperAdmin } = useTenant();
  const [search, setSearch] = useState('');

  const filteredWorkspaces = allWorkspaces.filter(w =>
    w.name.toLowerCase().includes(search.toLowerCase())
  );

  const getStatusBadge = (status) => {
    switch (status) {
      case 'active':
        return (
          <div className="flex items-center gap-1 text-emerald-600">
            <CheckCircle className="w-3 h-3" />
            <span className="text-xs font-medium">Active</span>
          </div>
        );
      case 'canceled':
        return (
          <div className="flex items-center gap-1 text-red-600">
            <Ban className="w-3 h-3" />
            <span className="text-xs font-medium">Canceled</span>
          </div>
        );
      case 'past_due':
        return (
          <div className="flex items-center gap-1 text-amber-600">
            <XCircle className="w-3 h-3" />
            <span className="text-xs font-medium">Past Due</span>
          </div>
        );
      default:
        return (
          <div className="flex items-center gap-1 text-slate-400">
            <XCircle className="w-3 h-3" />
            <span className="text-xs font-medium">Inactive</span>
          </div>
        );
    }
  };

  const getPlanBadge = (plan) => {
    const colors = {
      pro: 'bg-indigo-100 text-indigo-700',
      trial: 'bg-violet-100 text-violet-700',
      free: 'bg-slate-100 text-slate-600'
    };
    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${colors[plan] || colors.free}`}>
        {(plan || 'free').toUpperCase()}
      </span>
    );
  };

  if (!tenant) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="w-full px-4 py-3 rounded-xl hover:bg-slate-50 transition-colors text-left">
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-500 mb-1">Workspace</p>
              <p className="font-semibold text-slate-900 truncate">{tenant.name}</p>
              <div className="flex items-center gap-2 mt-1">
                {subscription && getPlanBadge(subscription.plan)}
                {subscription && getStatusBadge(subscription.status)}
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80 p-2" align="start">
        <div className="p-2 pb-3 border-b border-slate-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search workspaces..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          {isSuperAdmin && (
            <p className="text-xs text-indigo-600 mt-2 font-medium">
              Super Admin: Viewing all workspaces
            </p>
          )}
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {filteredWorkspaces.length === 0 ? (
            <div className="p-4 text-center text-sm text-slate-500">
              No workspaces found
            </div>
          ) : (
            filteredWorkspaces.map(workspace => {
              const isActive = workspace.id === tenant.id;
              // For non-super-admin, we should load subscriptions for each workspace
              // For now, we'll just show the workspace name
              
              return (
                <button
                  key={workspace.id}
                  onClick={() => {
                    if (!isActive) {
                      switchWorkspace(workspace.id);
                    }
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-indigo-50 border border-indigo-200'
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      isActive ? 'bg-indigo-600' : 'bg-slate-200'
                    }`}>
                      <Building2 className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-600'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium truncate ${
                        isActive ? 'text-indigo-900' : 'text-slate-900'
                      }`}>
                        {workspace.name}
                      </p>
                      <p className="text-xs text-slate-500 truncate">{workspace.slug}</p>
                      {isActive && (
                        <p className="text-xs text-indigo-600 mt-1 font-medium">
                          Current workspace
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}