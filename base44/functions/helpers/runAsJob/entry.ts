/**
 * runAsJob - Unified wrapper for all long-running operations
 * 
 * Ensures every background operation:
 * 1) Creates a BackgroundJob record
 * 2) Tracks progress (processed_count, success_count, failed_count)
 * 3) Sets final status (completed/failed/cancelled)
 * 4) Never silently fails
 */

export async function runAsJob(base44, config, workerFn) {
  const {
    tenant_id,
    job_type,
    total_items = 0,
    actor_user_id,
    meta = {},
    params = {}
  } = config;

  if (!tenant_id || !job_type) {
    throw new Error('runAsJob: tenant_id and job_type required');
  }

  let job = null;
  let error = null;

  try {
    // 1) Create job in queued state
    job = await base44.asServiceRole.entities.BackgroundJob.create({
      tenant_id,
      job_type,
      status: 'queued',
      started_at: new Date().toISOString(),
      progress_percent: 0,
      processed_count: 0,
      total_count: total_items,
      success_count: 0,
      failed_count: 0,
      actor_user_id,
      meta: meta || {},
      params: params || {}
    });

    // 2) Update to running
    await base44.asServiceRole.entities.BackgroundJob.update(job.id, {
      status: 'running'
    });

    // 3) Execute worker with progress callback
    const progressCallback = async (progress) => {
      await base44.asServiceRole.entities.BackgroundJob.update(job.id, progress);
    };

    const result = await workerFn(job, progressCallback);

    // 4) Mark as completed
    await base44.asServiceRole.entities.BackgroundJob.update(job.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      result: result || {}
    });

    return { success: true, job_id: job.id, result };

  } catch (err) {
    error = err;

    // 5) Mark as failed
    if (job) {
      await base44.asServiceRole.entities.BackgroundJob.update(job.id, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: err.message || String(err)
      }).catch(() => {}); // Ignore update errors, we're already in error state
    }

    throw new Error(`[${job_type}] Job failed: ${err.message}`);
  }
}

export default runAsJob;