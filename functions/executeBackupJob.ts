import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  let jobId, tenantId;
  try {
    const { jobId: jId, tenantId: tId } = await req.json();
    jobId = jId;
    tenantId = tId;
    
    const base44 = createClientFromRequest(req);

    if (!jobId || !tenantId) {
      return Response.json({ error: 'Missing jobId or tenantId' }, { status: 400 });
    }

    // Update job status to processing
    await base44.asServiceRole.entities.BackupJob.update(jobId, {
      status: 'processing'
    });

    // Fetch all workspace data in parallel with error handling
    const fetchEntity = async (entityName, query) => {
      try {
        const result = await base44.asServiceRole.entities[entityName].filter(query);
        return { data: result || [], error: null };
      } catch (err) {
        console.warn(`Failed to fetch ${entityName}:`, err.message);
        return { data: [], error: err.message };
      }
    };

    const [
      ordersResult,
      orderLinesResult,
      skusResult,
      storesResult,
      purchasesResult,
      currentStockResult,
      suppliersResult,
      stockMovementsResult,
      importBatchesResult,
      tasksResult,
      checklistResult,
      commentsResult,
      returnsResult
    ] = await Promise.all([
      fetchEntity('Order', { tenant_id: tenantId }),
      fetchEntity('OrderLine', { tenant_id: tenantId }),
      fetchEntity('SKU', { tenant_id: tenantId }),
      fetchEntity('Store', { tenant_id: tenantId }),
      fetchEntity('Purchase', { tenant_id: tenantId }),
      fetchEntity('CurrentStock', { tenant_id: tenantId }),
      fetchEntity('Supplier', { tenant_id: tenantId }),
      fetchEntity('StockMovement', { tenant_id: tenantId }),
      fetchEntity('ImportBatch', { tenant_id: tenantId }),
      fetchEntity('Task', { tenant_id: tenantId }),
      fetchEntity('TaskChecklistItem', {}),
      fetchEntity('TaskComment', {}),
      fetchEntity('Return', { tenant_id: tenantId })
    ]);

    const orders = ordersResult.data;
    const orderLines = orderLinesResult.data;
    const skus = skusResult.data;
    const stores = storesResult.data;
    const purchases = purchasesResult.data;
    const currentStock = currentStockResult.data;
    const suppliers = suppliersResult.data;
    const stockMovements = stockMovementsResult.data;
    const importBatches = importBatchesResult.data;
    const tasks = tasksResult.data;
    const checklistItems = checklistResult.data;
    const comments = commentsResult.data;
    const returns = returnsResult.data;

    // Track errors for diagnostics
    const entityErrors = Object.entries({
      Order: ordersResult.error,
      OrderLine: orderLinesResult.error,
      SKU: skusResult.error,
      Store: storesResult.error,
      Purchase: purchasesResult.error,
      CurrentStock: currentStockResult.error,
      Supplier: suppliersResult.error,
      StockMovement: stockMovementsResult.error,
      ImportBatch: importBatchesResult.error,
      Task: tasksResult.error,
      TaskChecklistItem: checklistResult.error,
      TaskComment: commentsResult.error,
      Return: returnsResult.error
    }).filter(([_, err]) => err !== null);

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
        tasks,
        checklistItems,
        comments,
        returns
      },
      stats: {
        orders: orders.length,
        skus: skus.length,
        purchases: purchases.length,
        suppliers: suppliers.length,
        stores: stores.length,
        tasks: tasks.length,
        orderLines: orderLines.length,
        currentStock: currentStock.length,
        stockMovements: stockMovements.length,
        importBatches: importBatches.length,
        checklistItems: checklistItems.length,
        comments: comments.length,
        returns: returns.length
      },
      warnings: entityErrors.length > 0 ? entityErrors.map(([name, err]) => `${name}: ${err}`) : []
    };

    // Validation: if workspace has SKUs/orders/purchases but backup shows zero, fail
    const hasData = (orders.length + skus.length + purchases.length) > 0;
    const backupHasData = (backupData.stats.orders + backupData.stats.skus + backupData.stats.purchases) > 0;
    
    if (hasData && !backupHasData) {
      throw new Error(`Backup validation failed: workspace has data but backup counts are zero. Orders: ${orders.length}, SKUs: ${skus.length}, Purchases: ${purchases.length}`);
    }

    // Convert to JSON and store backup data directly in the entity
    const jsonString = JSON.stringify(backupData, null, 2);
    const encoder = new TextEncoder();
    const jsonBytes = encoder.encode(jsonString);

    // Update job with success and stats
    await base44.asServiceRole.entities.BackupJob.update(jobId, {
      status: 'completed',
      backup_data: jsonString,
      file_size_bytes: jsonBytes.length,
      stats: backupData.stats,
      completed_at: new Date().toISOString()
    });

    return Response.json({
      success: true,
      jobId,
      sizeBytes: jsonBytes.length
    });
  } catch (error) {
    console.error('Execute backup job error:', error);

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