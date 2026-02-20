import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { jobId } = await req.json();

    if (!jobId) {
      return Response.json({ error: 'Missing jobId' }, { status: 400 });
    }

    // Fetch from BackgroundJob (new system)
    const backgroundJobs = await base44.asServiceRole.entities.BackgroundJob.filter({ 
      id: jobId,
      job_type: 'telegram_export'
    });

    if (!backgroundJobs || backgroundJobs.length === 0) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    const job = backgroundJobs[0];

    // Fetch errors for this job
    const errors = await base44.asServiceRole.entities.JobError.filter({
      job_id: jobId
    });

    const failedItemsLog = errors.map(err => ({
      sku_code: err.item_identifier,
      error_message: err.error_message,
      details: err.error_details || {}
    }));

    return Response.json({
      status: job.status,
      totalItems: job.total_count,
      sentItems: job.success_count,
      failedItems: job.failed_count,
      processedItems: job.processed_count,
      progressPercent: job.progress_percent || 0,
      errorMessage: job.error_message || null,
      failedItemsLog,
      completedAt: job.completed_at
    });

  } catch (error) {
    console.error('[Get Telegram Status] Error:', error);
    return Response.json({ 
      error: error.message,
      details: error.stack 
    }, { status: 500 });
  }
});