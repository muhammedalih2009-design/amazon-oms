import React from 'react';
import { Shield, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createPageUrl } from '../utils';
import { Link } from 'react-router-dom';

export default function ModuleDisabled() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center space-y-6 max-w-md p-8">
        <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center bg-amber-100">
          <Shield className="w-8 h-8 text-amber-600" />
        </div>
        
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-slate-900">Module Disabled</h1>
          <p className="text-slate-600">
            This page has been disabled for your workspace by the administrator.
          </p>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm text-amber-800">
            Contact your workspace administrator to request access to this module.
          </p>
        </div>

        <Link to={createPageUrl('Dashboard')}>
          <Button variant="outline" className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
}