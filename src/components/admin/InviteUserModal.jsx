import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { Copy, Check, Mail, Loader2 } from 'lucide-react';

export default function InviteUserModal({ open, onClose }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleInvite = async () => {
    if (!email || !email.includes('@')) {
      toast({
        title: 'Invalid Email',
        description: 'Please enter a valid email address',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);
    try {
      const response = await base44.functions.invoke('createPlatformInvite', { email });

      if (response.data.success) {
        setInviteLink(response.data.invite_link);
        toast({
          title: 'Invite Created',
          description: `Invite link generated for ${email}`
        });
      } else {
        toast({
          title: 'Error',
          description: response.data.error || 'Failed to create invite',
          variant: 'destructive'
        });
      }
    } catch (error) {
      console.error('Invite error:', error);
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to create invite',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast({
        title: 'Copied!',
        description: 'Invite link copied to clipboard'
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to copy link',
        variant: 'destructive'
      });
    }
  };

  const handleClose = () => {
    setEmail('');
    setInviteLink('');
    setCopied(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Invite User to Platform
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {!inviteLink ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                />
                <p className="text-sm text-muted-foreground">
                  User will be invited to the platform with ZERO workspace access.
                </p>
              </div>

              <div className="p-4 rounded-lg bg-amber-50 border border-amber-200">
                <p className="text-sm text-amber-800">
                  <strong>Important:</strong> This creates a platform-level invite only. 
                  After they accept, you must manually assign them to workspace(s) from the Users tab.
                </p>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-green-50 border border-green-200">
                <p className="text-sm text-green-800 font-medium mb-2">
                  ✓ Invite created successfully!
                </p>
                <p className="text-xs text-green-700">
                  Invited: <strong>{email}</strong>
                </p>
              </div>

              <div className="space-y-2">
                <Label>Invite Link</Label>
                <div className="flex gap-2">
                  <Input
                    value={inviteLink}
                    readOnly
                    className="font-mono text-sm"
                  />
                  <Button
                    onClick={handleCopy}
                    variant="outline"
                    size="icon"
                    className="flex-shrink-0"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-green-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Send this link to the user. It expires in 7 days.
                </p>
              </div>

              <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
                <p className="text-sm text-blue-800">
                  <strong>Next steps:</strong>
                </p>
                <ol className="text-sm text-blue-700 mt-2 space-y-1 list-decimal list-inside">
                  <li>Send the invite link to the user</li>
                  <li>After they accept and sign up, go to Users tab</li>
                  <li>Click "Assign Workspaces" to grant them access</li>
                </ol>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {!inviteLink ? (
            <>
              <Button variant="outline" onClick={handleClose} disabled={loading}>
                Cancel
              </Button>
              <Button onClick={handleInvite} disabled={loading || !email}>
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Invite'
                )}
              </Button>
            </>
          ) : (
            <Button onClick={handleClose}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}