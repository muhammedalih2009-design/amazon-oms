import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { job_id, action } = await req.json();

    if (!job_id || !action) {
      return Response.json({ 
        ok: false, 
        error: 'job_id and action required' 
      }, { status: 400 });
    }

    console.log(`[Manage Job] User ${user.email} performing ${action} on job ${job_id}`);

    const job = await base44.asServiceRole.entities.BackgroundJob.get(job_id);
    if (!job) {
      return Response.json({ ok: false, error: 'Job not found' }, { status: 404 });
    }

    let newStatus = job.status;
    let message = '';

    switch (action) {
      case 'pause':
        if (job.status === 'running' || job.status === 'throttled') {
          newStatus = 'paused';
          message = 'Job paused';
        } else {
          return Response.json({ ok: false, error: 'Job cannot be paused' }, { status: 400 });
        }
        break;

      case 'resume':
        if (job.status === 'paused') {
          newStatus = 'running';
          message = 'Job resumed';
          
          // Restart execution
          base44.functions.invoke('executeDeleteAllSkus', { job_id }).catch(err => {
            console.error('[Manage Job] Failed to resume job:', err);
          });
        } else {
          return Response.json({ ok: false, error: 'Job is not paused' }, { status: 400 });
        }
        break;

      case 'cancel':
        if (['queued', 'running', 'throttled', 'paused'].includes(job.status)) {
          newStatus = 'cancelled';
          message = 'Job cancelled';
        } else {
          return Response.json({ ok: false, error: 'Job cannot be cancelled' }, { status: 400 });
        }
        break;

      default:
        return Response.json({ ok: false, error: 'Invalid action' }, { status: 400 });
    }

    await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
      status: newStatus
    });

    console.log(`[Manage Job] Job ${job_id} updated to ${newStatus}`);

    return Response.json({
      ok: true,
      message,
      new_status: newStatus
    });

  } catch (error) {
    console.error('[Manage Job] Error:', error);
    return Response.json({
      ok: false,
      error: error.message || 'Failed to manage job'
    }, { status: 500 });
  }
});