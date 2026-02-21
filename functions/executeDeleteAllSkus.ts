import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BATCH_SIZE = 100;
const BASE_DELAY = 500; // 500ms between batches
const THROTTLED_DELAY = 2000; // 2s when throttled
const MAX_RUNTIME_MS = 5 * 60 * 1000; // 5 minutes max
const TERMINATION_GUARD_MS = 30 * 1000; // 30 seconds

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkCancellation(base44, job_id, startTime, processedCount) {
  const currentJob = await base44.asServiceRole.entities.BackgroundJob.get(job_id);
  
  // Check for cancelling status
  if (currentJob.status === 'cancelling') {
    console.log(`[Job ${job_id}] Cancelling detected, terminating immediately`);
    await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
      status: 'cancelled',
      completed_at: new Date().toISOString(),
      progress_percent: currentJob.progress_percent || 0,
      progress: {
        ...currentJob.progress,
        message: `Cancelled after processing ${processedCount} items`
      }
    });
    return { shouldStop: true, reason: 'cancelled' };
  }
  
  // Check for stuck in cancelling (termination guard)
  if (currentJob.cancel_requested_at) {
    const cancelAge = Date.now() - new Date(currentJob.cancel_requested_at).getTime();
    if (cancelAge > TERMINATION_GUARD_MS) {
      console.log(`[Job ${job_id}] Stuck in cancelling for ${cancelAge}ms, force terminating`);
      await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
        status: 'force_terminated',
        finished_at: new Date().toISOString(),
        progress: {
          ...currentJob.progress,
          message: `Force terminated after ${Math.round(cancelAge / 1000)}s in cancelling state`
        }
      });
      return { shouldStop: true, reason: 'force_terminated' };
    }
  }
  
  // Check for timeout
  const runtime = Date.now() - startTime;
  if (runtime > MAX_RUNTIME_MS) {
    console.log(`[Job ${job_id}] Timeout after ${runtime}ms, terminating`);
    await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
      status: 'timeout_cancelled',
      finished_at: new Date().toISOString(),
      progress: {
        ...currentJob.progress,
        message: `Timeout after ${Math.round(runtime / 1000 / 60)} minutes`
      }
    });
    return { shouldStop: true, reason: 'timeout' };
  }
  
  // Check for paused
  if (currentJob.status === 'paused') {
    console.log(`[Job ${job_id}] Paused, exiting`);
    return { shouldStop: true, reason: 'paused' };
  }
  
  return { shouldStop: false };
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
    const startTime = Date.now();

    // Check if already cancelled before starting
    if (job.status === 'cancelling' || job.cancel_requested_at) {
      console.log(`[Execute Delete All SKUs] Job ${job_id} cancelled before start`);
      await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
        status: 'cancelled',
        completed_at: new Date().toISOString(),
        error_message: 'Cancelled before execution started'
      });
      return Response.json({ ok: true, cancelled: true });
    }

    // Update job to running if it was queued
    if (job.status === 'queued') {
      await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
        status: 'running',
        started_at: new Date().toISOString(),
        last_heartbeat_at: new Date().toISOString()
      });
    }

    let processedCount = 0;
    let deletedCount = 0;
    let errorCount = 0;
    let currentDelay = BASE_DELAY;

    while (true) {
      // CRITICAL: Check for cancellation, timeout, termination
      const cancelCheck = await checkCancellation(base44, job_id, startTime, processedCount);
      if (cancelCheck.shouldStop) {
        return Response.json({ 
          ok: true, 
          message: `Job ${cancelCheck.reason}`, 
          processed: processedCount 
        });
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

      // Update progress with heartbeat
      const percent = Math.round((processedCount / job.params.total_skus) * 100);
      await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
        status: currentDelay === THROTTLED_DELAY ? 'throttled' : 'running',
        progress_percent: percent,
        processed_count: processedCount,
        success_count: deletedCount,
        failed_count: errorCount,
        last_heartbeat_at: new Date().toISOString(),
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
      progress_percent: 95,
      progress: {
        current: processedCount,
        total: job.params.total_skus,
        percent: 95,
        phase: 'cleanup',
        message: 'Cleaning up stock movements and current stock...'
      }
    });

    // Delete related entities in batches with cancellation checks
    const movements = await base44.asServiceRole.entities.StockMovement.filter({ tenant_id: workspace_id });
    const stocks = await base44.asServiceRole.entities.CurrentStock.filter({ tenant_id: workspace_id });

    // Process movements in batches
    for (let i = 0; i < movements.length; i += 50) {
      // Check for cancellation
      const cancelCheck = await checkCancellation(base44, job_id, startTime, processedCount);
      if (cancelCheck.shouldStop) {
        return Response.json({ 
          ok: true, 
          message: `Job ${cancelCheck.reason} during cleanup`, 
          processed: processedCount 
        });
      }

      const batch = movements.slice(i, i + 50);
      for (const movement of batch) {
        try {
          await base44.asServiceRole.entities.StockMovement.delete(movement.id);
        } catch (error) {
          console.error(`[Execute Delete All SKUs] Failed to delete movement:`, error.message);
        }
      }
    }

    // Process stocks in batches
    for (let i = 0; i < stocks.length; i += 50) {
      // Check for cancellation
      const cancelCheck = await checkCancellation(base44, job_id, startTime, processedCount);
      if (cancelCheck.shouldStop) {
        return Response.json({ 
          ok: true, 
          message: `Job ${cancelCheck.reason} during cleanup`, 
          processed: processedCount 
        });
      }

      const batch = stocks.slice(i, i + 50);
      for (const stock of batch) {
        try {
          await base44.asServiceRole.entities.CurrentStock.delete(stock.id);
        } catch (error) {
          console.error(`[Execute Delete All SKUs] Failed to delete stock:`, error.message);
        }
      }
    }

    // Mark job as completed
    await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      progress_percent: 100,
      processed_count: processedCount,
      success_count: deletedCount,
      failed_count: errorCount,
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