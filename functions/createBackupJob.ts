import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tenantId, backupName } = await req.json();

    if (!tenantId) {
      return Response.json({ error: 'Missing tenantId' }, { status: 400 });
    }

    // Create backup job record with queued status
    const job = await base44.asServiceRole.entities.BackupJob.create({
      tenant_id: tenantId,
      backup_name: backupName || `Backup ${new Date().toISOString().split('T')[0]}`,
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