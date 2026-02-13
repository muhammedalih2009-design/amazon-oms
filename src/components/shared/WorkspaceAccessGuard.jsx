import React from 'react';
import { useTenant } from '@/components/hooks/useTenant';
import { Ban, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function WorkspaceAccessGuard({ children }) {
  const { subscription, tenant } = useTenant();

  if (!subscription || !tenant) {
    return children;
  }

  // Blocked statuses
  if (subscription.status === 'canceled' || subscription.status === 'inactive') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="max-w-md text-center space-y-4">
          <Ban className="w-16 h-16 text-red-500 mx-auto" />
          <h1 className="text-2xl font-bold text-slate-900">Workspace Closed</h1>
          <p className="text-slate-600">
            This workspace has been {subscription.status}. All access is blocked.
          </p>
          <p className="text-sm text-slate-500">
            Contact the workspace owner or support for assistance.
          </p>
        </div>
      </div>
    );
  }

  // Warning for past_due
  if (subscription.status === 'past_due') {
    return (
      <div>
        <div className="bg-amber-50 border-b border-amber-200 p-4">
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900">
                Workspace Payment Past Due
              </p>
              <p className="text-xs text-amber-700">
                Some features may be limited. Please update your payment method.
              </p>
            </div>
          </div>
        </div>
        {children}
      </div>
    );
  }

  return children;
}