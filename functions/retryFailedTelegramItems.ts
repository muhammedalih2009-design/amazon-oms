import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { jobId } = await req.json();

    if (!jobId) {
      return Response.json({ error: 'Missing jobId' }, { status: 400 });
    }

    // Get all failed items for this job
    const failedItems = await base44.asServiceRole.entities.TelegramExportItem.filter({
      job_id: jobId,
      status: 'failed'
    });

    if (failedItems.length === 0) {
      return Response.json({ 
        message: 'No failed items to retry',
        count: 0 
      });
    }

    // Reset failed items back to pending
    for (const item of failedItems) {
      await base44.asServiceRole.entities.TelegramExportItem.update(item.id, {
        status: 'pending',
        error_message: null,
        sent_at: null
      });
    }

    // Update job to allow resume
    await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
      status: 'paused',
      can_resume: true,
      error_message: `${failedItems.length} failed items reset to pending. Ready to resume.`
    });

    return Response.json({
      success: true,
      message: `Reset ${failedItems.length} failed items to pending`,
      count: failedItems.length
    });

  } catch (error) {
    console.error('[Retry Failed Items] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});