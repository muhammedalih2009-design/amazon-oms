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

    // Get the job
    const job = await base44.asServiceRole.entities.BackgroundJob.get(jobId);
    if (!job) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    // Extract failed items from result
    const failedItems = job.result?.failedItems || [];

    return Response.json({
      status: job.status,
      totalItems: job.total_count,
      sentItems: job.success_count || 0,
      failedItems: job.failed_count || 0,
      processedItems: job.processed_count || 0,
      progressPercent: job.progress_percent || 0,
      errorMessage: job.error_message || null,
      failedItemsLog: failedItems,
      createdAt: job.created_date,
      completedAt: job.completed_at
    });

  } catch (error) {
    console.error('[Get Telegram Export Status] Error:', error);
    return Response.json({ 
      error: error.message,
      details: error.stack 
    }, { status: 500 });
  }
});