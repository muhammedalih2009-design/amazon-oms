import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { jobId, tenantId } = await req.json();

    if (!jobId || !tenantId) {
      return Response.json({ error: 'Missing jobId or tenantId' }, { status: 400 });
    }

    // Get the job
    const job = await base44.asServiceRole.entities.BackgroundJob.get(jobId);
    if (!job) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    // Only resumable jobs can be resumed
    if (!job.can_resume) {
      return Response.json({ error: 'This job cannot be resumed' }, { status: 400 });
    }

    // Reset status to queued and restart processing
    await base44.asServiceRole.entities.BackgroundJob.update(jobId, {
      status: 'queued',
      error_message: null
    });

    // Start processing asynchronously
    base44.asServiceRole.functions.invoke('processTelegramExportQueue', { 
      jobId,
      tenantId,
      resumeFromCheckpoint: true
    }).catch(err => {
      console.error(`[Resume Telegram Export] Failed to restart queue for job ${jobId}:`, err);
    });

    return Response.json({ 
      success: true, 
      jobId,
      message: 'Export resumed and processing continues from where it stopped'
    });

  } catch (error) {
    console.error('[Resume Telegram Export] Error:', error);
    return Response.json({ 
      error: error.message,
      details: error.stack 
    }, { status: 500 });
  }
});