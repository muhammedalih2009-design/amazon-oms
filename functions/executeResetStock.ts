import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Cancellation check helper
async function checkCancellation(base44, jobId) {
  try {
    const job = await base44.asServiceRole.entities.BackgroundJob.get(jobId);
    return job?.status === 'cancelling' || job?.cancel_requested_at;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const { job_id, workspace_id } = await req.json();

    if (!job_id || !workspace_id) {
      return Response.json({ error: 'Missing job_id or workspace_id' }, { status: 400 });
    }

    console.log(`[executeResetStock] Starting job ${job_id} for workspace ${workspace_id}`);

    // Fetch job
    const job = await base44.asServiceRole.entities.BackgroundJob.get(job_id);
    if (!job) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    // Check if already cancelled
    if (await checkCancellation(base44, job_id)) {
      console.log(`[executeResetStock] Job ${job_id} cancelled before start`);
      await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
        status: 'cancelled',
        completed_at: new Date().toISOString(),
        error_message: 'Cancelled by user'
      });
      return Response.json({ ok: true, cancelled: true });
    }

    // Update job to running
    await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
      status: 'running',
      started_at: new Date().toISOString(),
      progress_percent: 0
    });

    // Fetch all current stock records
    const allStock = await base44.asServiceRole.entities.CurrentStock.filter({ 
      tenant_id: workspace_id 
    });

    // Fetch all stock movements for archiving
    const allMovements = await base44.asServiceRole.entities.StockMovement.filter({ 
      tenant_id: workspace_id,
      is_archived: false
    });

    console.log(`[executeResetStock] Found ${allStock.length} stock records, ${allMovements.length} movements to archive`);

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    let totalProcessed = 0;
    let successCount = 0;
    let failedCount = 0;
    const BATCH_SIZE = 10;
    const totalSteps = allMovements.length + allStock.length;

    // Phase 1: Archive all existing movements in batches
    for (let i = 0; i < allMovements.length; i += BATCH_SIZE) {
      // Check for cancellation every batch
      if (await checkCancellation(base44, job_id)) {
        console.log(`[executeResetStock] Job ${job_id} cancelled during archive`);
        await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
          status: 'cancelled',
          completed_at: new Date().toISOString(),
          processed_count: totalProcessed,
          success_count: successCount,
          failed_count: failedCount,
          error_message: 'Cancelled by user during archiving'
        });
        return Response.json({ ok: true, cancelled: true });
      }

      const batch = allMovements.slice(i, i + BATCH_SIZE);
      for (const movement of batch) {
        try {
          await base44.asServiceRole.entities.StockMovement.update(movement.id, {
            is_archived: true
          });
          totalProcessed++;
          successCount++;
        } catch (error) {
          console.error(`[executeResetStock] Failed to archive movement ${movement.id}:`, error);
          failedCount++;
          totalProcessed++;
        }

        // Update progress every 5 items
        if (totalProcessed % 5 === 0) {
          const percent = Math.floor((totalProcessed / totalSteps) * 100);
          await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
            processed_count: totalProcessed,
            success_count: successCount,
            failed_count: failedCount,
            progress_percent: percent
          });
        }
      }

      if (i + BATCH_SIZE < allMovements.length) {
        await delay(300);
      }
    }

    console.log(`[executeResetStock] Archived ${successCount} movements, failed ${failedCount}`);

    // Phase 2: Reset all stock to 0 in batches
    for (let i = 0; i < allStock.length; i += BATCH_SIZE) {
      // Check for cancellation every batch
      if (await checkCancellation(base44, job_id)) {
        console.log(`[executeResetStock] Job ${job_id} cancelled during reset`);
        await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
          status: 'cancelled',
          completed_at: new Date().toISOString(),
          processed_count: totalProcessed,
          success_count: successCount,
          failed_count: failedCount,
          error_message: 'Cancelled by user during stock reset'
        });
        return Response.json({ ok: true, cancelled: true });
      }

      const batch = allStock.slice(i, i + BATCH_SIZE);
      for (const stock of batch) {
        try {
          await base44.asServiceRole.entities.CurrentStock.update(stock.id, {
            quantity_available: 0
          });

          // Create baseline movement record
          await base44.asServiceRole.entities.StockMovement.create({
            tenant_id: workspace_id,
            sku_id: stock.sku_id,
            sku_code: stock.sku_code,
            movement_type: 'reset_baseline',
            quantity: 0,
            reference_type: 'manual',
            reference_id: job_id,
            movement_date: new Date().toISOString().split('T')[0],
            notes: 'Stock reset to zero - baseline created',
            is_archived: false
          });

          totalProcessed++;
          successCount++;
        } catch (error) {
          console.error(`[executeResetStock] Failed to reset stock ${stock.id}:`, error);
          failedCount++;
          totalProcessed++;
        }

        // Update progress every 5 items
        if (totalProcessed % 5 === 0) {
          const percent = Math.floor((totalProcessed / totalSteps) * 100);
          await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
            processed_count: totalProcessed,
            success_count: successCount,
            failed_count: failedCount,
            progress_percent: percent
          });
        }
      }

      if (i + BATCH_SIZE < allStock.length) {
        await delay(300);
      }
    }

    // Mark job as completed
    await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      processed_count: totalProcessed,
      success_count: successCount,
      failed_count: failedCount,
      progress_percent: 100,
      result: {
        archived_movements_count: allMovements.length,
        affected_skus: allStock.length,
        success_count: successCount,
        failed_count: failedCount
      }
    });

    console.log(`[executeResetStock] Completed job ${job_id}. Processed: ${totalProcessed}, Success: ${successCount}, Failed: ${failedCount}`);

    return Response.json({ 
      ok: true,
      archived_movements_count: allMovements.length,
      affected_skus: allStock.length,
      success_count: successCount,
      failed_count: failedCount
    });

  } catch (error) {
    console.error('[executeResetStock] Fatal error:', error);
    
    // Try to mark job as failed
    try {
      const { job_id } = await req.json();
      if (job_id) {
        await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
          status: 'failed',
          error_message: error.message,
          completed_at: new Date().toISOString()
        });
      }
    } catch (updateError) {
      console.error('[executeResetStock] Failed to update job status:', updateError);
    }

    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});