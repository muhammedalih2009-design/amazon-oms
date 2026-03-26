import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tenantId, rows, dateRange } = await req.json();

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return Response.json({ error: 'Invalid rows data' }, { status: 400 });
    }

    // MANDATORY: Always create a background job BEFORE sending anything
    const job = await base44.asServiceRole.entities.BackgroundJob.create({
      tenant_id: tenantId,
      job_type: 'telegram_export',
      status: 'queued',
      priority: 'normal',
      total_count: rows.length,
      processed_count: 0,
      success_count: 0,
      failed_count: 0,
      progress_percent: 0,
      actor_user_id: user.id,
      started_by: user.email,
      params: {
        rows,
        dateRange,
        createdBy: user.email
      },
      started_at: new Date().toISOString()
    });

    console.log(`[Telegram Export] Job created: ${job.id} for tenant ${tenantId}`);

    // Start processing asynchronously (non-blocking)
    base44.asServiceRole.functions.invoke('processTelegramExportQueue', { 
      jobId: job.id,
      tenantId 
    }).catch(err => {
      console.error(`[Telegram Export] Failed to start queue for job ${job.id}:`, err);
    });

    return Response.json({ 
      success: true, 
      jobId: job.id,
      totalItems: rows.length
    });

  } catch (error) {
    console.error('[Telegram Export] Start error:', error);
    return Response.json({ 
      error: error.message,
      details: error.stack 
    }, { status: 500 });
  }
});