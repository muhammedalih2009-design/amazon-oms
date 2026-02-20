import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Universal job runner wrapper.
 * Ensures all operations create and track BackgroundJob records.
 * 
 * Usage:
 * const result = await runAsJob(req, {
 *   workspace_id,
 *   job_type: 'sku_bulk_upload',
 *   total_items: 150,
 *   meta: { filename: 'test.csv' }
 * }, async (job, updateProgress) => {
 *   // your work here
 *   for (let i = 0; i < items.length; i++) {
 *     // process item
 *     await updateProgress(i + 1, 1, 0); // processed, success, failed
 *   }
 *   return { summary: '...' };
 * });
 */
export async function runAsJob(req, jobConfig, worker) {
  const base44 = createClientFromRequest(req);
  
  const {
    workspace_id,
    job_type,
    total_items = 0,
    meta = {},
    started_by = null
  } = jobConfig;

  if (!workspace_id || !job_type) {
    throw new Error('workspace_id and job_type required');
  }

  const user = await base44.auth.me();
  if (!user) {
    throw new Error('Unauthorized');
  }

  let job = null;

  try {
    // Create job record
    job = await base44.asServiceRole.entities.BackgroundJob.create({
      tenant_id: workspace_id,
      job_type,
      status: 'running',
      total_count: total_items,
      processed_count: 0,
      success_count: 0,
      failed_count: 0,
      started_at: new Date().toISOString(),
      started_by: started_by || user.email,
      actor_user_id: user.id,
      meta
    });

    console.log(`[runAsJob] Created job ${job.id} (${job_type})`);

    // Progress updater
    const updateProgress = async (processed, success, failed, progressMsg = '') => {
      if (!job) return;
      const progressPercent = total_items > 0 ? (processed / total_items) * 100 : 0;
      await base44.asServiceRole.entities.BackgroundJob.update(job.id, {
        processed_count: processed,
        success_count: success,
        failed_count: failed,
        progress_percent: progressPercent,
        progress: {
          current: processed,
          total: total_items,
          percent: progressPercent,
          message: progressMsg
        },
        last_heartbeat_at: new Date().toISOString()
      });
    };

    // Run worker
    const result = await worker(job, updateProgress);

    // Mark completed
    await base44.asServiceRole.entities.BackgroundJob.update(job.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      result
    });

    console.log(`[runAsJob] Job ${job.id} completed`);

    return {
      ok: true,
      job_id: job.id,
      result
    };

  } catch (error) {
    console.error(`[runAsJob] Job failed:`, error);

    if (job) {
      await base44.asServiceRole.entities.BackgroundJob.update(job.id, {
        status: 'failed',
        error_message: error.message || 'Unknown error',
        completed_at: new Date().toISOString()
      }).catch(err => console.error('Failed to update job status:', err));
    }

    throw error;
  }
}

export default runAsJob;