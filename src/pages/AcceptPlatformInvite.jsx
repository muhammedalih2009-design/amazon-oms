import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AcceptPlatformInvite() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    acceptInvite();
  }, []);

  const acceptInvite = async () => {
    try {
      // Get token from URL
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');

      if (!token) {
        setError('No invite token provided');
        setLoading(false);
        return;
      }

      // Check if user is logged in
      const isAuth = await base44.auth.isAuthenticated();
      if (!isAuth) {
        // Redirect to login, then come back here
        base44.auth.redirectToLogin(window.location.href);
        return;
      }

      // Accept invite
      const response = await base44.functions.invoke('acceptPlatformInvite', { token });

      if (response.data.success) {
        setSuccess(true);
        setTimeout(() => {
          navigate(createPageUrl('NoAccess'));
        }, 2000);
      } else {
        setError(response.data.error || 'Failed to accept invite');
      }
    } catch (err) {
      console.error('Accept invite error:', err);
      setError(err.response?.data?.error || err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="max-w-md w-full">
        <div className="text-center space-y-6" style={{ backgroundColor: 'var(--surface)', borderRadius: '1rem', padding: '2.5rem', border: '1px solid var(--border)' }}>
          {/* Logo */}
          <div className="space-y-2">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
              Amazon OMS
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Platform Invite
            </p>
          </div>

          {/* Status */}
          {loading && (
            <div className="space-y-3">
              <Loader2 className="w-12 h-12 animate-spin mx-auto" style={{ color: 'var(--primary)' }} />
              <p style={{ color: 'var(--text-muted)' }}>
                Processing your invitation...
              </p>
            </div>
          )}

          {success && (
            <div className="space-y-3">
              <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center" style={{ backgroundColor: 'var(--success-soft)' }}>
                <CheckCircle2 className="w-8 h-8" style={{ color: 'var(--success)' }} />
              </div>
              <div>
                <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text)' }}>
                  Invite Accepted!
                </h2>
                <p style={{ color: 'var(--text-muted)' }}>
                  Redirecting to your account...
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="space-y-4">
              <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center" style={{ backgroundColor: 'var(--danger-soft)' }}>
                <AlertCircle className="w-8 h-8" style={{ color: 'var(--danger)' }} />
              </div>
              <div>
                <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text)' }}>
                  Invitation Error
                </h2>
                <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                  {error}
                </p>
                <Button
                  onClick={() => navigate(createPageUrl('Dashboard'))}
                  variant="outline"
                >
                  Go to Dashboard
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}