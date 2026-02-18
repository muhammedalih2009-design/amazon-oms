import React from 'react';
import { useTenant, PAGE_MODULE_MAP } from '@/components/hooks/useTenant';
import { Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createPageUrl } from '@/utils';
import { Link } from 'react-router-dom';

export default function ModuleAccessGuard({ children, pageName }) {
  const { canAccessModule, isPlatformAdmin, loading } = useTenant();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Platform admin bypasses module checks
  if (isPlatformAdmin) {
    return children;
  }

  // Check if module is enabled
  if (!canAccessModule(pageName)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="text-center space-y-4 max-w-md">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
            <Ban className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Module Not Enabled</h1>
          <p className="text-slate-600">
            The <strong>{pageName}</strong> module is not enabled for this workspace. 
            Contact your workspace administrator to enable it.
          </p>
          <Link to={createPageUrl('Dashboard')}>
            <Button className="mt-4">
              Go to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return children;
}