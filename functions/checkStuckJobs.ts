import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Failsafe function to cancel jobs stuck in "cancelling" state
 * Should be called periodically (e.g., via automation every 5 minutes)
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

    console.log('[checkStuckJobs] Starting stuck jobs check...');

    // Find jobs stuck in "cancelling" for more than 10 minutes
    const stuckCancelTimeout = 10 * 60 * 1000; // 10 minutes
    const now = Date.now();

    const allCancellingJobs = await base44.asServiceRole.entities.BackgroundJob.filter({
      status: 'cancelling'
    });

    console.log(`[checkStuckJobs] Found ${allCancellingJobs.length} cancelling jobs`);

    let fixedCount = 0;

    for (const job of allCancellingJobs) {
      const cancelRequestedAt = job.cancel_requested_at ? new Date(job.cancel_requested_at).getTime() : null;
      
      if (!cancelRequestedAt) {
        // No timestamp, mark as cancelled immediately
        console.log(`[checkStuckJobs] Fixing job ${job.id} (no cancel timestamp)`);
        await base44.asServiceRole.entities.BackgroundJob.update(job.id, {
          status: 'cancelled',
          completed_at: new Date().toISOString(),
          error_message: 'Cancelled by failsafe (stuck in cancelling state)'
        });
        fixedCount++;
        continue;
      }

      const timeInCancelling = now - cancelRequestedAt;
      
      if (timeInCancelling > stuckCancelTimeout) {
        console.log(`[checkStuckJobs] Fixing job ${job.id} (stuck for ${Math.round(timeInCancelling / 1000)}s)`);
        await base44.asServiceRole.entities.BackgroundJob.update(job.id, {
          status: 'cancelled',
          completed_at: new Date().toISOString(),
          error_message: 'Cancelled by failsafe (timeout in cancelling state)'
        });
        fixedCount++;
      }
    }

    console.log(`[checkStuckJobs] Fixed ${fixedCount} stuck jobs`);

    return Response.json({
      ok: true,
      checked: allCancellingJobs.length,
      fixed: fixedCount
    });
  } catch (error) {
    console.error('[checkStuckJobs] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});