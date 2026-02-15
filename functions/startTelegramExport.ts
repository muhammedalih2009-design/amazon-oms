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

    // Create export job
    const job = await base44.entities.TelegramExportJob.create({
      tenant_id: tenantId,
      status: 'pending',
      total_items: rows.length,
      sent_items: 0,
      failed_items: 0,
      current_supplier: '',
      current_index: 0,
      rows_data: JSON.stringify(rows),
      date_range: dateRange,
      failed_items_log: [],
      started_at: new Date().toISOString()
    });

    // Start processing asynchronously
    base44.functions.invoke('processTelegramExportQueue', { jobId: job.id }).catch(err => {
      console.error('Failed to start telegram export queue:', err);
    });

    return Response.json({ 
      success: true, 
      jobId: job.id,
      totalItems: rows.length
    });

  } catch (error) {
    console.error('Start telegram export error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});