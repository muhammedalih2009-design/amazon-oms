import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const { jobId, restoreFromPrevious } = await req.json();
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!jobId) {
      return Response.json({ error: 'Missing jobId' }, { status: 400 });
    }

    // Get the job to check tenant ownership
    const job = await base44.asServiceRole.entities.BackupJob.get(jobId);
    if (!job) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    // If restoring from previous, fetch the previous backup
    let previousBackup = null;
    if (restoreFromPrevious) {
      const allJobs = await base44.asServiceRole.entities.BackupJob.filter({ 
        tenant_id: job.tenant_id,
        status: 'completed'
      });
      const sortedJobs = allJobs.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
      const currentIndex = sortedJobs.findIndex(j => j.id === jobId);
      if (currentIndex >= 0 && currentIndex < sortedJobs.length - 1) {
        previousBackup = sortedJobs[currentIndex + 1];
      }
    }

    // Delete the job
    await base44.asServiceRole.entities.BackupJob.delete(jobId);

    return Response.json({ 
      success: true, 
      previousBackup: previousBackup ? {
        id: previousBackup.id,
        backup_name: previousBackup.backup_name,
        backup_data: previousBackup.backup_data,
        started_at: previousBackup.started_at
      } : null
    });
  } catch (error) {
    console.error('Delete backup job error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});