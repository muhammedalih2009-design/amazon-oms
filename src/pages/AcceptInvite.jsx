import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from './utils';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

export default function AcceptInvite() {
  const [status, setStatus] = useState('loading'); // loading | success | error
  const [message, setMessage] = useState('');
  const [workspaceId, setWorkspaceId] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const acceptInvite = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');

        if (!token) {
          setStatus('error');
          setMessage('Invalid invite link: Missing token');
          return;
        }

        // Check if user is logged in
        const isAuth = await base44.auth.isAuthenticated();
        if (!isAuth) {
          // Redirect to login, then back here
          const currentUrl = window.location.href;
          base44.auth.redirectToLogin(currentUrl);
          return;
        }

        // Accept the invite
        const { data } = await base44.functions.invoke('acceptInvite', { token });

        if (data.success) {
          setStatus('success');
          setWorkspaceId(data.workspace_id);
          
          if (data.already_member) {
            setMessage('You are already a member of this workspace!');
          } else {
            setMessage('Invitation accepted successfully!');
          }

          // Redirect to dashboard after 2 seconds
          setTimeout(() => {
            window.location.href = createPageUrl('Dashboard');
          }, 2000);
        } else {
          setStatus('error');
          setMessage(data.error || 'Failed to accept invite');
        }
      } catch (error) {
        console.error('Accept invite error:', error);
        setStatus('error');
        setMessage(error.response?.data?.error || 'An unexpected error occurred');
      }
    };

    acceptInvite();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="max-w-md w-full">
        <div className="text-center space-y-6 p-8 rounded-xl" style={{ backgroundColor: 'var(--surface)', boxShadow: '0 4px 6px var(--shadow)' }}>
          {status === 'loading' && (
            <>
              <Loader2 className="w-16 h-16 mx-auto animate-spin text-indigo-600" />
              <h2 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>
                Processing Invitation
              </h2>
              <p style={{ color: 'var(--text-muted)' }}>
                Please wait while we add you to the workspace...
              </p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle className="w-16 h-16 mx-auto text-green-600" />
              <h2 className="text-2xl font-bold text-green-600">
                Success!
              </h2>
              <p style={{ color: 'var(--text-muted)' }}>
                {message}
              </p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Redirecting to dashboard...
              </p>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="w-16 h-16 mx-auto text-red-600" />
              <h2 className="text-2xl font-bold text-red-600">
                Error
              </h2>
              <p style={{ color: 'var(--text-muted)' }}>
                {message}
              </p>
              <button
                onClick={() => window.location.href = createPageUrl('Dashboard')}
                className="mt-4 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Go to Dashboard
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}