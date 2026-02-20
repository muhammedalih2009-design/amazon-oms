import React from 'react';
import { Shield, Mail } from 'lucide-react';
import { useTenant } from '@/components/hooks/useTenant';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';

export default function NoAccessPage() {
  const { user } = useTenant();

  const handleLogout = () => {
    base44.auth.logout();
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="max-w-md w-full">
        <div className="text-center space-y-6" style={{ backgroundColor: 'var(--surface)', borderRadius: '1rem', padding: '2.5rem', border: '1px solid var(--border)' }}>
          {/* Icon */}
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full" style={{ backgroundColor: 'var(--warning-soft)' }}>
            <Shield className="w-8 h-8" style={{ color: 'var(--warning)' }} />
          </div>
          
          {/* Title */}
          <div className="space-y-2">
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>
              No Workspace Access
            </h1>
            <p style={{ color: 'var(--text-muted)' }}>
              You are not assigned to any workspaces
            </p>
          </div>

          {/* User Info */}
          <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--accent)' }}>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text)' }}>
              Logged in as:
            </p>
            <p className="text-sm font-mono" style={{ color: 'var(--text-muted)' }}>
              {user?.email}
            </p>
          </div>

          {/* Instructions */}
          <div className="space-y-3 text-left p-4 rounded-lg" style={{ backgroundColor: 'var(--accent)', border: '1px solid var(--border)' }}>
            <div className="flex items-start gap-3">
              <Mail className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--primary)' }} />
              <div className="space-y-1">
                <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                  To get access:
                </p>
                <ul className="text-sm space-y-1" style={{ color: 'var(--text-muted)' }}>
                  <li>• Contact the workspace administrator</li>
                  <li>• Request an invitation to a workspace</li>
                  <li>• Wait for the admin to grant you access</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Logout Button */}
          <Button
            onClick={handleLogout}
            variant="outline"
            className="w-full"
          >
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
}