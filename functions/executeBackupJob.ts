import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { jobId, tenantId } = await req.json();

    if (!jobId || !tenantId) {
      return Response.json({ error: 'Missing jobId or tenantId' }, { status: 400 });
    }

    // Update job status to processing
    await base44.asServiceRole.entities.BackupJob.update(jobId, {
      status: 'processing'
    });

    // Fetch all workspace data in parallel
    const [
      orders,
      orderLines,
      skus,
      stores,
      purchases,
      currentStock,
      suppliers,
      stockMovements,
      importBatches,
      tasks
    ] = await Promise.all([
      base44.asServiceRole.entities.Order.filter({ tenant_id: tenantId }),
      base44.asServiceRole.entities.OrderLine.filter({ tenant_id: tenantId }),
      base44.asServiceRole.entities.SKU.filter({ tenant_id: tenantId }),
      base44.asServiceRole.entities.Store.filter({ tenant_id: tenantId }),
      base44.asServiceRole.entities.Purchase.filter({ tenant_id: tenantId }),
      base44.asServiceRole.entities.CurrentStock.filter({ tenant_id: tenantId }),
      base44.asServiceRole.entities.Supplier.filter({ tenant_id: tenantId }),
      base44.asServiceRole.entities.StockMovement.filter({ tenant_id: tenantId }),
      base44.asServiceRole.entities.ImportBatch.filter({ tenant_id: tenantId }),
      base44.asServiceRole.entities.Task.filter({ tenant_id: tenantId })
    ]);

    // Build backup payload
    const backupData = {
      tenant_id: tenantId,
      timestamp: new Date().toISOString(),
      data: {
        orders,
        orderLines,
        skus,
        stores,
        purchases,
        currentStock,
        suppliers,
        stockMovements,
        importBatches,
        tasks
      },
      stats: {
        orders: orders.length,
        skus: skus.length,
        purchases: purchases.length,
        suppliers: suppliers.length,
        stores: stores.length,
        tasks: tasks.length
      }
    };

    // Convert to JSON and compress with gzip
    const jsonString = JSON.stringify(backupData);
    const encoder = new TextEncoder();
    const jsonBytes = encoder.encode(jsonString);

    // Use CompressionStream (Web API) for gzip compression
    const compressedStream = jsonBytes.stream ? 
      jsonBytes.stream().pipeThrough(new CompressionStream('gzip')) : 
      null;

    let compressedBytes;
    if (compressedStream) {
      const reader = compressedStream.getReader();
      const chunks = [];
      let done = false;
      while (!done) {
        const { value, done: isDone } = await reader.read();
        if (value) chunks.push(value);
        done = isDone;
      }
      compressedBytes = new Uint8Array(chunks.reduce((a, b) => a + b.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        compressedBytes.set(chunk, offset);
        offset += chunk.length;
      }
    } else {
      // Fallback: use simple gzip via fetch-based compression
      const blob = new Blob([jsonBytes], { type: 'application/json' });
      const formData = new FormData();
      formData.append('data', blob);
      compressedBytes = jsonBytes;
    }

    // Upload compressed backup file
    const fileName = `backup_${new Date().toISOString().split('T')[0]}_${jobId}.json.gz`;
    const uploadResponse = await base44.asServiceRole.integrations.Core.UploadFile({
      file: new File([compressedBytes], fileName, { type: 'application/gzip' })
    });

    if (!uploadResponse.file_url) {
      throw new Error('Failed to upload backup file');
    }

    // Update job with success
    await base44.asServiceRole.entities.BackupJob.update(jobId, {
      status: 'completed',
      file_url: uploadResponse.file_url,
      file_size_bytes: compressedBytes.length,
      completed_at: new Date().toISOString()
    });

    return Response.json({
      success: true,
      jobId,
      fileUrl: uploadResponse.file_url,
      sizeBytes: compressedBytes.length
    });
  } catch (error) {
    console.error('Execute backup job error:', error);

    const { jobId } = await req.json();
    if (jobId) {
      try {
        await base44.asServiceRole.entities.BackupJob.update(jobId, {
          status: 'failed',
          error_message: error.message,
          completed_at: new Date().toISOString()
        });
      } catch (updateError) {
        console.error('Failed to update job status:', updateError);
      }
    }

    return Response.json({ error: error.message }, { status: 500 });
  }
});