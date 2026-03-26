import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * CRITICAL FAILSAFE: Cancel jobs stuck in "cancelling" OR dead jobs with no heartbeat
 * Runs every 5 minutes via automation
 * Super Admin only
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Super Admin only
    const isPlatformAdmin = user?.email?.toLowerCase() === 'muhammedalih.2009@gmail.com';
    if (!isPlatformAdmin) {
      return Response.json({ error: 'Platform admin access required' }, { status: 403 });
    }

    console.log('[checkStuckJobs] Starting aggressive stuck jobs cleanup...');

    const now = Date.now();
    const stuckTimeout = 2 * 60 * 1000; // 2 minutes

    // Find ALL non-terminal jobs
    const activeJobs = await base44.asServiceRole.entities.BackgroundJob.filter({
      status: { $in: ['cancelling', 'running', 'queued', 'paused', 'throttled'] }
    });

    console.log(`[checkStuckJobs] Found ${activeJobs.length} active jobs to check`);

    let fixedCount = 0;
    const fixes = [];

    for (const job of activeJobs) {
      let shouldFix = false;
      let reason = '';

      // CASE 1: Stuck in "cancelling" for > 2 minutes
      if (job.status === 'cancelling') {
        const cancelRequestedAt = job.cancel_requested_at ? new Date(job.cancel_requested_at).getTime() : null;
        
        if (!cancelRequestedAt) {
          shouldFix = true;
          reason = 'stuck_in_cancelling_no_timestamp';
        } else {
          const timeInCancelling = now - cancelRequestedAt;
          if (timeInCancelling > stuckTimeout) {
            shouldFix = true;
            reason = `stuck_in_cancelling_${Math.round(timeInCancelling / 1000)}s`;
          }
        }
      }

      // CASE 2: Running/queued but no heartbeat for > 2 minutes
      if (['running', 'queued'].includes(job.status)) {
        const lastUpdate = job.last_heartbeat_at || job.updated_date || job.created_date;
        const timeSinceUpdate = now - new Date(lastUpdate).getTime();
        
        if (timeSinceUpdate > stuckTimeout) {
          shouldFix = true;
          reason = `no_heartbeat_${Math.round(timeSinceUpdate / 1000)}s`;
        }
      }

      if (shouldFix) {
        console.log(`[checkStuckJobs] Fixing job ${job.id} (${job.job_type}): ${reason}`);
        
        try {
          await base44.asServiceRole.entities.BackgroundJob.update(job.id, {
            status: 'cancelled',
            completed_at: new Date().toISOString(),
            error_message: `Auto-cancelled by failsafe: ${reason}`,
            progress_percent: job.progress_percent || 0
          });

          fixedCount++;
          fixes.push({
            job_id: job.id,
            job_type: job.job_type,
            previous_status: job.status,
            reason
          });
        } catch (error) {
          console.error(`[checkStuckJobs] Failed to fix job ${job.id}:`, error);
        }
      }
    }

    console.log(`[checkStuckJobs] Fixed ${fixedCount} stuck jobs:`, fixes);

    return Response.json({
      ok: true,
      checked: activeJobs.length,
      fixed: fixedCount,
      fixes
    });
  } catch (error) {
    console.error('[checkStuckJobs] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});