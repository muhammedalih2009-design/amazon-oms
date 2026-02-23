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

    // Get the background job
    const job = await base44.asServiceRole.entities.BackgroundJob.get(jobId);
    
    if (!job) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    // Get checkpoint items for detailed status
    const allItems = await base44.asServiceRole.entities.TelegramExportItem.filter({
      job_id: jobId
    });

    const sentItems = allItems.filter(i => i.status === 'sent');
    const failedItems = allItems.filter(i => i.status === 'failed');
    const pendingItems = allItems.filter(i => i.status === 'pending');

    // Get failed items details
    const failedItemsLog = failedItems.map(item => ({
      sku_code: item.sku_code,
      product: item.product_name,
      supplier: item.supplier_id,
      error_message: item.error_message,
      index: item.index
    }));

    return Response.json({
      status: job.status,
      totalItems: allItems.length || job.progress_total || 0,
      sentItems: sentItems.length,
      failedItems: failedItems.length,
      pendingItems: pendingItems.length,
      processedItems: sentItems.length + failedItems.length,
      progressPercent: job.progress_percent || 0,
      errorMessage: job.error_message,
      failedItemsLog,
      currentSupplier: job.result?.currentSupplier,
      lastSentItem: job.result?.lastSentItem,
      lastSentAt: job.result?.lastSentAt,
      canResume: job.can_resume || pendingItems.length > 0,
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