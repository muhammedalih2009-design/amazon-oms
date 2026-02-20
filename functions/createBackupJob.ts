import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { guardWorkspaceAccess } from './helpers/guardWorkspaceAccess.js';

Deno.serve(async (req) => {
  try {
    const { tenantId, backupName } = await req.json();
    
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!tenantId) {
      return Response.json({ error: 'Missing tenantId' }, { status: 400 });
    }

    // SECURITY: Verify user has access to this workspace
    const membership = await guardWorkspaceAccess(base44, user, tenantId);

    // Only owner/admin can create backups
    if (!['owner', 'admin'].includes(membership.role)) {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get tenant info
    const tenant = await base44.asServiceRole.entities.Tenant.get(tenantId);
    
    // Create backup job record with source workspace metadata
    const job = await base44.asServiceRole.entities.BackupJob.create({
      tenant_id: tenantId,
      backup_name: backupName || `Backup ${new Date().toISOString().split('T')[0]}`,
      source_workspace_id: tenantId,
      source_workspace_name: tenant?.name || 'Unknown',
      backup_version: '1.0',
      status: 'queued',
      started_at: new Date().toISOString()
    });

    // Return job ID immediately (async processing)
    return Response.json({ 
      jobId: job.id,
      status: 'queued'
    });
  } catch (error) {
    console.error('Create backup job error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});