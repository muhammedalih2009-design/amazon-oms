import React from 'react';
import { useTenant } from '@/components/hooks/useTenant';
import { CheckCircle2, Lock, Shield } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const PAGES = [
  { key: 'dashboard', name: 'Dashboard' },
  { key: 'skus', name: 'SKUs / Products' },
  { key: 'orders', name: 'Orders' },
  { key: 'purchases', name: 'Purchases' },
  { key: 'returns', name: 'Returns' },
  { key: 'settlement', name: 'Settlement' },
  { key: 'suppliers', name: 'Suppliers' }
];

export default function MyAccessSummary() {
  const { permissions, isOwner, membership } = useTenant();

  if (isOwner) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-purple-600" />
            Your Permissions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl p-6 text-center border border-purple-200">
            <Shield className="w-12 h-12 text-purple-600 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-purple-900 mb-2">Owner - Full Access</h3>
            <p className="text-sm text-purple-700">
              As the workspace owner, you have unrestricted access to all features and settings.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const allowedPages = PAGES.filter(page => permissions[page.key]?.view);
  const restrictedPages = PAGES.filter(page => !permissions[page.key]?.view);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-600" />
            Your Permissions
          </CardTitle>
          <Badge className="bg-slate-100 text-slate-700">
            {membership?.role?.toUpperCase()}
          </Badge>
        </div>
        <p className="text-sm text-slate-500 mt-2">
          Your current access level and feature restrictions
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-2 gap-6">
          {/* Allowed Features */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Access Granted</h3>
                <p className="text-xs text-slate-500">{allowedPages.length} features available</p>
              </div>
            </div>
            <div className="space-y-2">
              {allowedPages.map(page => (
                <div 
                  key={page.key} 
                  className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg"
                >
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-900">{page.name}</p>
                    <p className="text-xs text-slate-600">
                      {permissions[page.key]?.edit ? 'View & Edit' : 'View Only'}
                    </p>
                  </div>
                </div>
              ))}
              {allowedPages.length === 0 && (
                <p className="text-sm text-slate-500 italic p-3 bg-slate-50 rounded-lg text-center">
                  No access granted yet
                </p>
              )}
            </div>
          </div>

          {/* Restricted Features */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                <Lock className="w-5 h-5 text-slate-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Access Restricted</h3>
                <p className="text-xs text-slate-500">{restrictedPages.length} features locked</p>
              </div>
            </div>
            <div className="space-y-2">
              {restrictedPages.map(page => (
                <div 
                  key={page.key} 
                  className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg opacity-60"
                >
                  <Lock className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  <p className="text-sm font-medium text-slate-700">{page.name}</p>
                </div>
              ))}
              {restrictedPages.length === 0 && (
                <p className="text-sm text-green-700 italic p-3 bg-green-50 rounded-lg text-center">
                  You have access to all features! 🎉
                </p>
              )}
            </div>
          </div>
        </div>

        {restrictedPages.length > 0 && (
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-900">
              <strong>Need access to a restricted feature?</strong> Contact your workspace owner to request additional permissions.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}