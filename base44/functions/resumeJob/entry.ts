import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { job_id } = await req.json();

    if (!job_id) {
      return Response.json({ error: 'job_id required' }, { status: 400 });
    }

    // Get job
    const job = await base44.asServiceRole.entities.BackgroundJob.get(job_id);
    if (!job) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    // Validate permission
    const isPlatformAdmin = user.role === 'admin' || user.email === 'your-admin@email.com';
    if (!isPlatformAdmin) {
      const memberships = await base44.asServiceRole.entities.Membership.filter({
        workspace_id: job.tenant_id,
        user_id: user.id
      });
      
      const isWorkspaceAdmin = memberships.some(m => m.role === 'owner' || m.role === 'admin');
      if (!isWorkspaceAdmin) {
        return Response.json({ error: 'Permission denied' }, { status: 403 });
      }
    }

    // Validate status and can_resume
    if (!['paused', 'failed'].includes(job.status)) {
      return Response.json({ 
        error: `Cannot resume job with status: ${job.status}` 
      }, { status: 400 });
    }

    if (job.can_resume === false) {
      return Response.json({ 
        error: 'This job cannot be resumed' 
      }, { status: 400 });
    }

    // Check for other running jobs in same workspace (concurrency = 1)
    const runningJobs = await base44.asServiceRole.entities.BackgroundJob.filter({
      tenant_id: job.tenant_id,
      status: 'running'
    });

    if (runningJobs.length > 0) {
      // Queue instead of running immediately
      await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
        status: 'queued'
      });

      await base44.asServiceRole.entities.AuditLog.create({
        workspace_id: job.tenant_id,
        user_id: user.id,
        user_email: user.email,
        action: 'job_resume_requested',
        entity_type: 'BackgroundJob',
        entity_id: job_id,
        metadata: {
          job_type: job.job_type,
          queued: true,
          reason: 'Another job is running'
        }
      });

      return Response.json({
        success: true,
        message: 'Job queued (another job is running)',
        status: 'queued'
      });
    }

    // Update to resuming
    await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
      status: 'resuming'
    });

    // Audit log
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id: job.tenant_id,
      user_id: user.id,
      user_email: user.email,
      action: 'job_resume_requested',
      entity_type: 'BackgroundJob',
      entity_id: job_id,
      metadata: {
        job_type: job.job_type
      }
    });

    // Trigger appropriate job runner based on job type
    const jobRunners = {
      'delete_all_skus': 'executeDeleteAllSkus',
      'recompute_workspace': 'recomputeWorkspace',
      'backup': 'executeBackupJob',
      'restore': 'executeRestoreJob'
    };

    const runnerFunction = jobRunners[job.job_type];
    if (runnerFunction) {
      base44.functions.invoke(runnerFunction, { job_id }).catch(err => {
        console.error('Failed to resume job:', err);
      });
    }

    return Response.json({
      success: true,
      message: 'Job resume initiated'
    });
  } catch (error) {
    console.error('Error resuming job:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});