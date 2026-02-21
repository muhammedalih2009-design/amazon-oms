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
      console.error('[forceStopJob] Missing job_id in request');
      return Response.json({ error: 'job_id required' }, { status: 400 });
    }

    console.log('[forceStopJob] Request for job_id:', job_id);

    // Get job
    const job = await base44.asServiceRole.entities.BackgroundJob.get(job_id);
    if (!job) {
      console.error('[forceStopJob] Job not found:', job_id);
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    console.log('[forceStopJob] Found job:', { id: job.id, type: job.job_type, status: job.status, tenant: job.tenant_id });

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

    // Validate status - allow queued jobs to be cancelled too
    if (!['queued', 'running', 'throttled', 'pausing', 'resuming', 'paused'].includes(job.status)) {
      console.log(`[forceStopJob] Cannot stop job ${job_id} with status: ${job.status}`);
      return Response.json({ 
        error: `Cannot force stop job with status: ${job.status}. Only queued/running/paused jobs can be stopped.` 
      }, { status: 400 });
    }

    console.log(`[forceStopJob] Stopping job ${job_id} (status: ${job.status})`);

    // CRITICAL FIX: If job is queued, mark as cancelled immediately (not running yet)
    // If job is running, mark as cancelling (worker will see and stop)
    const newStatus = job.status === 'queued' ? 'cancelled' : 'cancelling';
    
    await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
      status: newStatus,
      can_resume: false,
      cancel_requested_at: new Date().toISOString(),
      ...(newStatus === 'cancelled' && {
        completed_at: new Date().toISOString(),
        error_message: 'Cancelled by user before execution started'
      })
    });

    // Audit log
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id: job.tenant_id,
      actor_user_id: user.id,
      action: 'job_force_stop_requested',
      target_type: 'BackgroundJob',
      target_id: job_id,
      meta: {
        job_type: job.job_type,
        previous_status: job.status,
        user_email: user.email
      }
    });

    console.log('[forceStopJob] Successfully stopped job:', job_id);

    return Response.json({
      success: true,
      message: 'Job force stop requested'
    });
  } catch (error) {
    console.error('Error force stopping job:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});