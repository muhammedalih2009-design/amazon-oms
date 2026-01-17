import React from 'react';
import { useTenant } from '@/components/hooks/useTenant';
import { ShieldAlert } from 'lucide-react';

export default function PagePermissionGuard({ pageKey, children }) {
  const { canViewPage, loading } = useTenant();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!canViewPage(pageKey)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-10 h-10 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Access Denied</h1>
          <p className="text-slate-600 mb-4">
            You don't have permission to view this page. Please contact your workspace owner if you need access.
          </p>
        </div>
      </div>
    );
  }

  return children;
}