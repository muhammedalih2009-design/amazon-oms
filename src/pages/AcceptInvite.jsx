import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AcceptInvite() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); // loading, success, error
  const [message, setMessage] = useState('');
  const [workspaceId, setWorkspaceId] = useState(null);

  useEffect(() => {
    acceptInvite();
  }, []);

  const acceptInvite = async () => {
    try {
      // Get token from URL
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');

      if (!token) {
        setStatus('error');
        setMessage('Invalid invite link. No token provided.');
        return;
      }

      // Check if user is logged in
      const isAuthenticated = await base44.auth.isAuthenticated();
      
      if (!isAuthenticated) {
        // Redirect to login with full return URL
        const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?from_url=${returnUrl}`;
        return;
      }

      // Accept the invite
      const { data } = await base44.functions.invoke('acceptInvite', { token });

      if (data.ok) {
        setStatus('success');
        setMessage(data.message);
        setWorkspaceId(data.workspace_id);
        
        // Switch to invited workspace and reload
        if (data.workspace_id) {
          localStorage.setItem('active_workspace_id', data.workspace_id);
        }
        
        // Auto-redirect after 2 seconds
        setTimeout(() => {
          window.location.href = '/'; // Force reload to update workspace context
        }, 2000);
      } else {
        setStatus('error');
        setMessage(data.error || 'Failed to accept invite');
      }
    } catch (error) {
      setStatus('error');
      setMessage(error.response?.data?.error || error.message);
    }
  };

  const handleGoToDashboard = () => {
    window.location.href = '/'; // Force reload
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          {status === 'loading' && (
            <>
              <Loader2 className="w-16 h-16 text-indigo-600 animate-spin mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-slate-900 mb-2">Processing Invite</h1>
              <p className="text-slate-600">Please wait while we add you to the workspace...</p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-10 h-10 text-green-600" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900 mb-2">Welcome!</h1>
              <p className="text-slate-600 mb-6">{message}</p>
              <p className="text-sm text-slate-500 mb-6">
                Redirecting to your workspace...
              </p>
              <Button onClick={handleGoToDashboard} className="w-full bg-indigo-600 hover:bg-indigo-700">
                Go to Dashboard
              </Button>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <XCircle className="w-10 h-10 text-red-600" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900 mb-2">Invite Error</h1>
              <p className="text-slate-600 mb-6">{message}</p>
              <Button onClick={() => navigate('/')} variant="outline" className="w-full">
                Go to Home
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}