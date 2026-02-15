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

    const job = await base44.entities.TelegramExportJob.filter({ id: jobId });

    if (!job || job.length === 0) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    const jobData = job[0];

    return Response.json({
      status: jobData.status,
      totalItems: jobData.total_items,
      sentItems: jobData.sent_items,
      failedItems: jobData.failed_items,
      currentSupplier: jobData.current_supplier || '',
      failedItemsLog: jobData.failed_items_log || [],
      completedAt: jobData.completed_at
    });

  } catch (error) {
    console.error('Get telegram export status error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});