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

    // SECURITY: Platform Admin only
    const isPlatformAdmin = user.email?.toLowerCase() === 'muhammedalih.2009@gmail.com';
    
    if (!isPlatformAdmin) {
      console.warn('[forceStopJob] Permission denied for user:', user.email);
      return Response.json({ 
        error: 'Access denied. Only platform administrators can manage background jobs.' 
      }, { status: 403 });
    }

    // Check if job is already in terminal state (idempotent)
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      console.log(`[forceStopJob] Job ${job_id} already in terminal state: ${job.status}`);
      return Response.json({ 
        success: true,
        message: `Job already ${job.status}`,
        status: job.status
      });
    }

    // Validate status - allow queued/running/paused jobs to be cancelled
    if (!['queued', 'running', 'throttled', 'pausing', 'resuming', 'paused', 'cancelling'].includes(job.status)) {
      console.log(`[forceStopJob] Cannot stop job ${job_id} with status: ${job.status}`);
      return Response.json({ 
        error: `Cannot force stop job with status: ${job.status}` 
      }, { status: 400 });
    }

    console.log(`[forceStopJob] Stopping job ${job_id} (current status: ${job.status})`);

    // CRITICAL: Immediate cancellation for queued jobs, mark as "cancelling" for running jobs
    const newStatus = job.status === 'queued' ? 'cancelled' : 'cancelling';
    const now = new Date().toISOString();
    
    const updates = {
      status: newStatus,
      can_resume: false,
      cancel_requested_at: now,
      last_heartbeat_at: now
    };

    // If queued, mark as completed immediately
    if (newStatus === 'cancelled') {
      updates.completed_at = now;
      updates.error_message = 'Cancelled by platform admin before execution started';
      updates.progress_percent = 0;
    }
    
    await base44.asServiceRole.entities.BackgroundJob.update(job_id, updates);
    
    console.log(`[forceStopJob] Job ${job_id} marked as ${newStatus}`);

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