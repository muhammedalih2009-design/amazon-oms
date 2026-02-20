import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tenant_id, rows, filename } = await req.json();

    if (!tenant_id || !Array.isArray(rows) || rows.length === 0) {
      return Response.json({ error: 'tenant_id and rows required' }, { status: 400 });
    }

    // Create background job
    const job = await base44.asServiceRole.entities.BackgroundJob.create({
      tenant_id,
      job_type: 'purchases_bulk_upload',
      status: 'queued',
      total_count: rows.length,
      processed_count: 0,
      success_count: 0,
      failed_count: 0,
      started_at: new Date().toISOString(),
      actor_user_id: user.id,
      meta: {
        filename,
        row_count: rows.length
      },
      params: {
        filename,
        rows_json: JSON.stringify(rows)
      }
    });

    // Trigger async execution
    base44.functions.invoke('executePurchasesImport', { job_id: job.id }).catch(err => {
      console.error('[Start Purchases Import] Async execution failed:', err);
    });

    return Response.json({
      ok: true,
      job_id: job.id,
      message: 'Import started'
    });

  } catch (error) {
    console.error('[Start Purchases Import] Error:', error);
    return Response.json({
      error: error.message || 'Failed to start import'
    }, { status: 500 });
  }
});