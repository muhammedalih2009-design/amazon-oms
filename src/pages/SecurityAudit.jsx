import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { Shield, AlertTriangle, CheckCircle, Trash2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';

const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';

export default function SecurityAudit() {
  const { user, isOwner } = useTenant();
  const { toast } = useToast();
  const [auditReport, setAuditReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [cleanupReport, setCleanupReport] = useState(null);

  // Only app owner can access
  if (user?.email?.toLowerCase() !== APP_OWNER_EMAIL.toLowerCase()) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <Alert variant="destructive">
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>
            Access Denied: Only the app owner can access security audit tools.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const runAudit = async (workspaceId = null) => {
    setLoading(true);
    try {
      const { data } = await base44.functions.invoke('security/auditWorkspaceAccess', {
        workspace_id: workspaceId
      });
      setAuditReport(data);
      toast({
        title: 'Audit Complete',
        description: `Found ${data.total_memberships} memberships across ${data.total_workspaces} workspaces`
      });
    } catch (error) {
      toast({
        title: 'Audit Failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const runCleanup = async (dryRun = true) => {
    setLoading(true);
    try {
      const { data } = await base44.functions.invoke('security/cleanupInvalidMemberships', {
        dry_run: dryRun
      });
      setCleanupReport(data);
      toast({
        title: dryRun ? 'Cleanup Preview' : 'Cleanup Complete',
        description: `Invalid: ${data.invalid_workspace_ids.found}, Duplicates: ${data.duplicates.found}`
      });
    } catch (error) {
      toast({
        title: 'Cleanup Failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Shield className="w-8 h-8 text-red-600" />
            Security Audit & Repair
          </h1>
          <p className="text-slate-600 mt-2">
            P0 Security: Workspace isolation audit and membership cleanup tools
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Audit Workspace Access</CardTitle>
            <CardDescription>
              Review all workspace memberships and detect suspicious patterns
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button 
              onClick={() => runAudit()} 
              disabled={loading}
              className="w-full"
            >
              <Shield className="w-4 h-4 mr-2" />
              Run Full Audit
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cleanup Invalid Memberships</CardTitle>
            <CardDescription>
              Remove memberships with invalid workspace IDs and duplicates
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button 
              onClick={() => runCleanup(true)} 
              disabled={loading}
              variant="outline"
              className="w-full"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Preview Cleanup (Dry Run)
            </Button>
            <Button 
              onClick={() => runCleanup(false)} 
              disabled={loading}
              variant="destructive"
              className="w-full"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Execute Cleanup
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Audit Report */}
      {auditReport && (
        <Card>
          <CardHeader>
            <CardTitle>Audit Report</CardTitle>
            <CardDescription>
              Generated: {new Date(auditReport.timestamp).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">
                  {auditReport.total_workspaces}
                </div>
                <div className="text-sm text-slate-600">Total Workspaces</div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  {auditReport.total_memberships}
                </div>
                <div className="text-sm text-slate-600">Total Memberships</div>
              </div>
              <div className="bg-red-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-red-600">
                  {auditReport.suspicious_users.length}
                </div>
                <div className="text-sm text-slate-600">Suspicious Users</div>
              </div>
            </div>

            {auditReport.suspicious_users.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="w-4 h-4" />
                <AlertDescription>
                  <strong>Suspicious Users (member of 5+ workspaces):</strong>
                  <ul className="mt-2 space-y-1">
                    {auditReport.suspicious_users.map((u, i) => (
                      <li key={i}>{u.email}: {u.workspace_count} workspaces</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-3 max-h-96 overflow-y-auto">
              {auditReport.workspaces.map((ws, i) => (
                <div key={i} className="border rounded-lg p-3">
                  <div className="font-semibold">{ws.workspace_name}</div>
                  <div className="text-sm text-slate-600">
                    {ws.member_count} members
                  </div>
                  <div className="mt-2 space-y-1">
                    {ws.members.map((m, j) => (
                      <div key={j} className="text-sm flex justify-between">
                        <span>{m.user_email}</span>
                        <span className="text-slate-500">{m.role}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cleanup Report */}
      {cleanupReport && (
        <Card>
          <CardHeader>
            <CardTitle>Cleanup Report</CardTitle>
            <CardDescription>
              {cleanupReport.dry_run ? 'Preview (No Changes Made)' : 'Cleanup Executed'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className={`p-4 rounded-lg ${cleanupReport.invalid_workspace_ids.found > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
                <div className="text-2xl font-bold">
                  {cleanupReport.invalid_workspace_ids.found}
                </div>
                <div className="text-sm text-slate-600">Invalid Workspace IDs</div>
                {!cleanupReport.dry_run && (
                  <div className="text-xs text-slate-500 mt-1">
                    Removed: {cleanupReport.invalid_workspace_ids.removed}
                  </div>
                )}
              </div>
              <div className={`p-4 rounded-lg ${cleanupReport.duplicates.found > 0 ? 'bg-orange-50' : 'bg-green-50'}`}>
                <div className="text-2xl font-bold">
                  {cleanupReport.duplicates.found}
                </div>
                <div className="text-sm text-slate-600">Duplicate Memberships</div>
                {!cleanupReport.dry_run && (
                  <div className="text-xs text-slate-500 mt-1">
                    Removed: {cleanupReport.duplicates.removed}
                  </div>
                )}
              </div>
            </div>

            {cleanupReport.invalid_workspace_ids.memberships.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Invalid Workspace IDs:</h3>
                <div className="space-y-1 text-sm max-h-48 overflow-y-auto">
                  {cleanupReport.invalid_workspace_ids.memberships.map((m, i) => (
                    <div key={i} className="flex justify-between border-b pb-1">
                      <span>{m.user_email}</span>
                      <span className="text-slate-500">{m.workspace_id}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {cleanupReport.duplicates.memberships.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Duplicate Memberships:</h3>
                <div className="space-y-1 text-sm max-h-48 overflow-y-auto">
                  {cleanupReport.duplicates.memberships.map((m, i) => (
                    <div key={i} className="flex justify-between border-b pb-1">
                      <span>{m.user_email}</span>
                      <span className="text-slate-500">{m.workspace_id}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}