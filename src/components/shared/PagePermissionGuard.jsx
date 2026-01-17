import React from 'react';
import { useTenant } from '@/components/hooks/useTenant';
import { ShieldAlert, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { base44 } from '@/api/base44Client';

export default function PagePermissionGuard({ pageKey, children }) {
  const { canViewPage, loading, tenant, membership } = useTenant();
  const { toast } = useToast();

  const handleRequestAccess = async () => {
    try {
      // Find the workspace owner
      const memberships = await base44.entities.Membership.filter({ 
        tenant_id: tenant.id,
        role: 'owner'
      });

      if (memberships.length > 0) {
        const ownerEmail = memberships[0].user_email;
        
        // Send notification email to owner
        await base44.integrations.Core.SendEmail({
          to: ownerEmail,
          subject: `Access Request: ${pageKey}`,
          body: `
            ${membership.user_email} has requested access to the "${pageKey}" module.
            
            Please review their permissions in the Team Management page if you'd like to grant them access.
            
            Workspace: ${tenant.name}
          `
        });

        toast({
          title: 'Access request sent',
          description: 'The workspace owner has been notified of your request.'
        });
      }
    } catch (error) {
      toast({
        title: 'Failed to send request',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!canViewPage(pageKey)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <ShieldAlert className="w-10 h-10 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-3">Access Denied</h1>
          <p className="text-slate-600 mb-6">
            You don't have permission to view the <strong>{pageKey}</strong> page. 
            Your current role restricts access to this module.
          </p>
          
          <div className="space-y-3">
            <Button 
              onClick={handleRequestAccess}
              className="w-full bg-indigo-600 hover:bg-indigo-700"
            >
              <Mail className="w-4 h-4 mr-2" />
              Request Access from Admin
            </Button>
            
            <p className="text-xs text-slate-500">
              The workspace owner will be notified and can grant you access through Team Management.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return children;
}