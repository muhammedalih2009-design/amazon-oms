import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Mail, X, Check } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';

export default function PendingInvitesChecker() {
  const [pendingInvites, setPendingInvites] = useState([]);
  const [showDialog, setShowDialog] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    checkPendingInvites();
  }, []);

  const checkPendingInvites = async () => {
    try {
      const { data } = await base44.functions.invoke('checkPendingInvites', {});
      
      if (data.ok && data.invites.length > 0) {
        setPendingInvites(data.invites);
        setShowDialog(true);
      }
    } catch (error) {
      console.error('Error checking pending invites:', error);
    }
  };

  const handleAcceptInvite = async (token) => {
    setAccepting(true);
    try {
      const { data } = await base44.functions.invoke('acceptInvite', { token });

      if (data.ok) {
        toast({
          title: 'Invite Accepted',
          description: 'You have been added to the workspace',
        });

        // Remove from pending list
        setPendingInvites(prev => prev.filter(inv => inv.token !== token));
        
        // Reload page to update workspace list
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.response?.data?.error || error.message,
      });
    } finally {
      setAccepting(false);
    }
  };

  if (pendingInvites.length === 0) {
    return null;
  }

  return (
    <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-indigo-600" />
            Workspace Invitations
          </AlertDialogTitle>
          <AlertDialogDescription>
            You have {pendingInvites.length} pending workspace invitation{pendingInvites.length > 1 ? 's' : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 max-h-96 overflow-y-auto">
          {pendingInvites.map((invite) => (
            <div
              key={invite.id}
              className="flex items-center justify-between p-4 border rounded-lg bg-slate-50"
            >
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-900">
                  Invited to workspace
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="outline">{invite.role}</Badge>
                  <span className="text-xs text-slate-500">
                    by {invite.invited_by_email}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Expires: {new Date(invite.expires_at).toLocaleDateString()}
                </p>
              </div>
              <Button
                onClick={() => handleAcceptInvite(invite.token)}
                disabled={accepting}
                className="bg-indigo-600 hover:bg-indigo-700"
                size="sm"
              >
                <Check className="w-4 h-4 mr-2" />
                {accepting ? 'Accepting...' : 'Accept'}
              </Button>
            </div>
          ))}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={accepting}>
            Close
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}