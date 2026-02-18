import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BATCH_SIZE = 100;
const BASE_DELAY = 500; // 500ms between batches
const THROTTLED_DELAY = 2000; // 2s when throttled

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    const { job_id } = await req.json();

    if (!job_id) {
      return Response.json({ ok: false, error: 'job_id required' }, { status: 400 });
    }

    console.log(`[Execute Delete All SKUs] Starting job ${job_id}`);

    // Get job details
    const job = await base44.asServiceRole.entities.BackgroundJob.get(job_id);
    if (!job) {
      return Response.json({ ok: false, error: 'Job not found' }, { status: 404 });
    }

    const workspace_id = job.tenant_id;

    // Update job to running if it was queued
    if (job.status === 'queued') {
      await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
        status: 'running',
        started_at: new Date().toISOString()
      });
    }

    let processedCount = 0;
    let deletedCount = 0;
    let errorCount = 0;
    let currentDelay = BASE_DELAY;

    while (true) {
      // Check job status (might have been paused/cancelled)
      const currentJob = await base44.asServiceRole.entities.BackgroundJob.get(job_id);
      
      if (currentJob.status === 'paused') {
        console.log(`[Execute Delete All SKUs] Job ${job_id} paused, exiting`);
        return Response.json({ ok: true, message: 'Job paused' });
      }
      
      if (currentJob.status === 'cancelled') {
        console.log(`[Execute Delete All SKUs] Job ${job_id} cancelled, exiting`);
        return Response.json({ ok: true, message: 'Job cancelled' });
      }

      // Fetch next batch of SKUs
      const skus = await base44.asServiceRole.entities.SKU.filter(
        { tenant_id: workspace_id },
        null,
        BATCH_SIZE
      );

      if (skus.length === 0) {
        console.log(`[Execute Delete All SKUs] No more SKUs to delete`);
        break;
      }

      console.log(`[Execute Delete All SKUs] Deleting batch of ${skus.length} SKUs`);

      // Delete SKUs in this batch
      for (const sku of skus) {
        try {
          await base44.asServiceRole.entities.SKU.delete(sku.id);
          deletedCount++;
        } catch (error) {
          console.error(`[Execute Delete All SKUs] Failed to delete SKU ${sku.id}:`, error.message);
          errorCount++;
          
          // If rate limited, increase delay
          if (error.message?.toLowerCase().includes('rate limit')) {
            currentDelay = THROTTLED_DELAY;
            await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
              status: 'throttled'
            });
            console.log(`[Execute Delete All SKUs] Rate limited, increasing delay to ${currentDelay}ms`);
          }
        }
        processedCount++;
      }

      // Update progress
      const percent = Math.round((processedCount / job.params.total_skus) * 100);
      await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
        status: currentDelay === THROTTLED_DELAY ? 'throttled' : 'running',
        progress: {
          current: processedCount,
          total: job.params.total_skus,
          percent,
          phase: 'deleting',
          message: `Deleted ${deletedCount} of ${job.params.total_skus} SKUs`
        }
      });

      // Delay between batches
      await sleep(currentDelay);

      // Reset delay if not throttled recently
      if (currentDelay === THROTTLED_DELAY) {
        currentDelay = BASE_DELAY;
      }
    }

    // Job completed - now clean up related data
    console.log(`[Execute Delete All SKUs] Cleaning up related entities...`);

    await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
      progress: {
        current: processedCount,
        total: job.params.total_skus,
        percent: 95,
        phase: 'cleanup',
        message: 'Cleaning up stock movements and current stock...'
      }
    });

    // Delete related entities
    const [movements, stocks] = await Promise.all([
      base44.asServiceRole.entities.StockMovement.filter({ tenant_id: workspace_id }),
      base44.asServiceRole.entities.CurrentStock.filter({ tenant_id: workspace_id })
    ]);

    for (const movement of movements) {
      try {
        await base44.asServiceRole.entities.StockMovement.delete(movement.id);
      } catch (error) {
        console.error(`[Execute Delete All SKUs] Failed to delete movement:`, error.message);
      }
    }

    for (const stock of stocks) {
      try {
        await base44.asServiceRole.entities.CurrentStock.delete(stock.id);
      } catch (error) {
        console.error(`[Execute Delete All SKUs] Failed to delete stock:`, error.message);
      }
    }

    // Mark job as completed
    await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      progress: {
        current: processedCount,
        total: job.params.total_skus,
        percent: 100,
        phase: 'completed',
        message: `Successfully deleted ${deletedCount} SKUs`
      },
      result: {
        deleted_skus: deletedCount,
        errors: errorCount,
        deleted_movements: movements.length,
        deleted_stocks: stocks.length
      }
    });

    console.log(`[Execute Delete All SKUs] Job ${job_id} completed: deleted ${deletedCount} SKUs, ${errorCount} errors`);

    // Check if there are queued jobs for this workspace
    const queuedJobs = await base44.asServiceRole.entities.BackgroundJob.filter({
      tenant_id: workspace_id,
      status: 'queued'
    });

    if (queuedJobs.length > 0) {
      const nextJob = queuedJobs[0];
      console.log(`[Execute Delete All SKUs] Starting next queued job: ${nextJob.id}`);
      
      // Start next job
      base44.functions.invoke('executeDeleteAllSkus', { job_id: nextJob.id }).catch(err => {
        console.error('[Execute Delete All SKUs] Failed to start next job:', err);
      });
    }

    return Response.json({
      ok: true,
      deleted_skus: deletedCount,
      errors: errorCount
    });

  } catch (error) {
    console.error('[Execute Delete All SKUs] Fatal error:', error);
    
    // Try to mark job as failed
    try {
      const { job_id } = await req.json();
      if (job_id) {
        await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: error.message || 'Unknown error'
        });
      }
    } catch (updateError) {
      console.error('[Execute Delete All SKUs] Failed to update job status:', updateError);
    }

    return Response.json({
      ok: false,
      error: error.message || 'Job execution failed'
    }, { status: 500 });
  }
});