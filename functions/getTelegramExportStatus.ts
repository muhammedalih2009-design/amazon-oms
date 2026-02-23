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

    // Get plan items
    const allItems = await base44.asServiceRole.entities.TelegramExportPlanItem.filter({
      job_id: jobId
    });

    const productItems = allItems.filter(p => p.item_type === 'product');
    const sentProducts = productItems.filter(p => p.status === 'sent');
    const failedProducts = productItems.filter(p => p.status === 'failed');
    const pendingProducts = productItems.filter(p => p.status === 'pending');

    // Get failed items details
    const failedItemsLog = failedProducts.map(item => ({
      sku_code: item.sku_code,
      product: item.product_name,
      supplier: item.supplier_name_display,
      error_message: item.error_message,
      sort_index: item.sort_index
    }));

    return Response.json({
      status: job.status,
      totalItems: productItems.length,
      sentItems: sentProducts.length,
      failedItems: failedProducts.length,
      pendingItems: pendingProducts.length,
      progressPercent: job.progress_percent || 0,
      errorMessage: job.error_message,
      failedItemsLog,
      currentSupplier: job.result?.currentSupplier,
      lastSentItem: job.result?.lastSentItem,
      lastSentAt: job.result?.lastSentAt,
      canResume: job.can_resume || pendingProducts.length > 0,
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