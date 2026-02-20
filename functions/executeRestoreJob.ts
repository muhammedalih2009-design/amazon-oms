import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { checkCancellation, finalizeJob } from './helpers/checkCancellation.js';

const BATCH_SIZE = 15; // Small batches for stability
const MAX_RETRIES = 5;
const BASE_DELAY = 2000;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { restoreJobId, resumeFromCheckpoint } = await req.json();

    if (!restoreJobId) {
      return Response.json({ error: 'restoreJobId required' }, { status: 400 });
    }

    // Get restore job
    const job = await base44.asServiceRole.entities.RestoreJob.get(restoreJobId);
    if (!job) {
      return Response.json({ error: 'Restore job not found' }, { status: 404 });
    }

    // Check cancellation before starting
    if (await checkCancellation(base44, restoreJobId, 'RestoreJob')) {
      await finalizeJob(base44, restoreJobId, 'RestoreJob', 'cancelled');
      return Response.json({ ok: true, cancelled: true });
    }

    // Parse backup data
    const backupData = JSON.parse(job.backup_data);
    const dataSource = backupData.data || backupData.tables || backupData;
    const targetWorkspaceId = job.target_workspace_id;

    console.log(`🔄 RESTORE STARTING - Job: ${restoreJobId}, Target: ${targetWorkspaceId}`);

    // Helper: Update job status
    const updateJob = async (updates) => {
      await base44.asServiceRole.entities.RestoreJob.update(restoreJobId, updates);
    };

    // Helper: Log error
    const logError = async (phase, entity, batchIndex, error, retryable = true) => {
      const errorEntry = {
        timestamp: new Date().toISOString(),
        phase,
        entity,
        batch_index: batchIndex,
        error_message: error.message,
        retryable,
        retry_count: 0
      };
      const currentLog = job.error_log || [];
      await updateJob({ error_log: [...currentLog, errorEntry] });
    };

    // Helper: Preserve IDs and force tenant_id
    const prepareRecords = (items, preserveIds = true) => {
      if (!Array.isArray(items) || items.length === 0) return [];
      return items.map(({ created_date, updated_date, created_by, tenant_id, ...rest }) => ({
        ...rest,
        tenant_id: targetWorkspaceId
        // ID is preserved by including it in ...rest
      }));
    };

    // Helper: Bulk create with retries and checkpointing
    const bulkCreateWithRetry = async (entityName, records, batchIndex, totalBatches) => {
      if (!records || records.length === 0) return [];

      const cleaned = prepareRecords(records);
      
      // Validate tenant_id
      const wrongTenant = cleaned.filter(r => r.tenant_id !== targetWorkspaceId);
      if (wrongTenant.length > 0) {
        throw new Error(`SECURITY: ${wrongTenant.length} ${entityName} records have wrong tenant_id!`);
      }

      let attempt = 0;
      while (attempt < MAX_RETRIES) {
        try {
          const created = await base44.asServiceRole.entities[entityName].bulkCreate(cleaned);
          return created;
        } catch (error) {
          attempt++;
          const isRateLimit = error.message?.includes('rate limit') || 
                              error.message?.includes('429') ||
                              error.message?.includes('too many');
          const is502 = error.message?.includes('502') || error.message?.includes('Bad Gateway');
          
          if ((isRateLimit || is502) && attempt < MAX_RETRIES) {
            const backoffDelay = BASE_DELAY * Math.pow(2, attempt - 1);
            console.log(`⏳ ${entityName} batch ${batchIndex}/${totalBatches} - retry ${attempt}/${MAX_RETRIES} after ${backoffDelay}ms`);
            await updateJob({
              progress: {
                ...job.progress,
                current_entity: entityName,
                current_batch: batchIndex,
                total_batches: totalBatches
              }
            });
            await delay(backoffDelay);
          } else {
            await logError('restoring', entityName, batchIndex, error, is502 || isRateLimit);
            throw error;
          }
        }
      }
      throw new Error(`${entityName} failed after ${MAX_RETRIES} attempts`);
    };

    try {
      // Update to processing
      await updateJob({
        status: 'processing',
        current_phase: resumeFromCheckpoint ? 'restoring' : 'purging',
        resumed_count: resumeFromCheckpoint ? (job.resumed_count || 0) + 1 : job.resumed_count
      });

      // PHASE 1: PURGE (skip if resuming from checkpoint)
      if (!resumeFromCheckpoint) {
        console.log('📊 PHASE 1: Counting existing data...');
        await updateJob({ current_phase: 'purging' });

        const [orders, orderLines, skus, stores, purchases, currentStock, suppliers, 
               stockMovements, importBatches, importErrors, profitabilityLines, 
               profitabilityBatches, tasks, checklistItems, comments] = await Promise.all([
          base44.asServiceRole.entities.Order.filter({ tenant_id: targetWorkspaceId }),
          base44.asServiceRole.entities.OrderLine.filter({ tenant_id: targetWorkspaceId }),
          base44.asServiceRole.entities.SKU.filter({ tenant_id: targetWorkspaceId }),
          base44.asServiceRole.entities.Store.filter({ tenant_id: targetWorkspaceId }),
          base44.asServiceRole.entities.Purchase.filter({ tenant_id: targetWorkspaceId }),
          base44.asServiceRole.entities.CurrentStock.filter({ tenant_id: targetWorkspaceId }),
          base44.asServiceRole.entities.Supplier.filter({ tenant_id: targetWorkspaceId }),
          base44.asServiceRole.entities.StockMovement.filter({ tenant_id: targetWorkspaceId }),
          base44.asServiceRole.entities.ImportBatch.filter({ tenant_id: targetWorkspaceId }),
          base44.asServiceRole.entities.ImportError.filter({ tenant_id: targetWorkspaceId }),
          base44.asServiceRole.entities.ProfitabilityLine.filter({ tenant_id: targetWorkspaceId }),
          base44.asServiceRole.entities.ProfitabilityImportBatch.filter({ tenant_id: targetWorkspaceId }),
          base44.asServiceRole.entities.Task.filter({ tenant_id: targetWorkspaceId }),
          base44.asServiceRole.entities.TaskChecklistItem.filter({ tenant_id: targetWorkspaceId }),
          base44.asServiceRole.entities.TaskComment.filter({ tenant_id: targetWorkspaceId })
        ]);

        const countsBefore = {
          orders: orders.length,
          orderLines: orderLines.length,
          skus: skus.length,
          stores: stores.length,
          purchases: purchases.length,
          currentStock: currentStock.length,
          suppliers: suppliers.length,
          stockMovements: stockMovements.length,
          importBatches: importBatches.length,
          importErrors: importErrors.length,
          profitabilityLines: profitabilityLines.length,
          profitabilityBatches: profitabilityBatches.length,
          tasks: tasks.length,
          checklistItems: checklistItems.length,
          comments: comments.length
        };

        await updateJob({ counts_before_purge: countsBefore });

        console.log('🗑️ PHASE 1: Purging existing data...');
        const deleteWithDelay = async (items, entityName, delayMs = 100) => {
          for (let i = 0; i < items.length; i++) {
            await base44.asServiceRole.entities[entityName].delete(items[i].id);
            if (i % 10 === 0 && i > 0) await delay(delayMs);
          }
        };

        // Delete in dependency order
        await deleteWithDelay(profitabilityLines, 'ProfitabilityLine', 100);
        await deleteWithDelay(profitabilityBatches, 'ProfitabilityImportBatch', 80);
        await deleteWithDelay(orderLines, 'OrderLine', 200);
        await deleteWithDelay(orders, 'Order', 200);
        await deleteWithDelay(purchases, 'Purchase', 100);
        await deleteWithDelay(currentStock, 'CurrentStock', 100);
        await deleteWithDelay(stockMovements, 'StockMovement', 100);
        await deleteWithDelay(skus, 'SKU', 100);
        await deleteWithDelay(suppliers, 'Supplier', 80);
        await deleteWithDelay(stores, 'Store', 80);
        await deleteWithDelay(importErrors, 'ImportError', 80);
        await deleteWithDelay(importBatches, 'ImportBatch', 80);
        await deleteWithDelay(checklistItems, 'TaskChecklistItem', 80);
        await deleteWithDelay(comments, 'TaskComment', 80);
        await deleteWithDelay(tasks, 'Task', 80);

        console.log('✅ PHASE 1: Purge complete');
      }

      // PHASE 2: RESTORE with checkpointing
      console.log('📦 PHASE 2: Restoring data...');
      await updateJob({ current_phase: 'restoring' });

      const checkpoint = job.checkpoint_payload || { id_map: {}, completed_entities: [] };
      const completedEntities = new Set(checkpoint.completed_entities || []);

      // Entity restore configuration (order matters for dependencies)
      const restoreConfig = [
        { name: 'Supplier', data: dataSource.suppliers, delay: 1000 },
        { name: 'Store', data: dataSource.stores, delay: 1000 },
        { name: 'SKU', data: dataSource.skus, delay: 2000 },
        { name: 'CurrentStock', data: dataSource.currentStock, delay: 1500 },
        { name: 'StockMovement', data: dataSource.stockMovements, delay: 1500 },
        { name: 'ImportBatch', data: dataSource.importBatches, delay: 1000 },
        { name: 'ImportError', data: dataSource.importErrors, delay: 1000 },
        { name: 'Order', data: dataSource.orders, delay: 2000 },
        { name: 'OrderLine', data: dataSource.orderLines, delay: 2000 },
        { name: 'Purchase', data: dataSource.purchases, delay: 1500 },
        { name: 'PurchaseCart', data: dataSource.purchaseRequests, delay: 1200 },
        { name: 'ProfitabilityLine', data: dataSource.profitabilityLines, delay: 1200 },
        { name: 'ProfitabilityImportBatch', data: dataSource.profitabilityBatches, delay: 1000 },
        { name: 'Task', data: dataSource.tasks, delay: 1000 },
        { name: 'TaskChecklistItem', data: dataSource.checklistItems, delay: 1000 },
        { name: 'TaskComment', data: dataSource.comments, delay: 1000 }
      ];

      let totalProcessed = 0;
      const totalRows = restoreConfig.reduce((sum, cfg) => sum + (cfg.data?.length || 0), 0);

      for (const config of restoreConfig) {
        if (!config.data || config.data.length === 0) continue;
        
        // Skip if already completed in checkpoint
        if (completedEntities.has(config.name)) {
          console.log(`⏭️ Skipping ${config.name} (already completed)`);
          totalProcessed += config.data.length;
          continue;
        }

        console.log(`📝 Restoring ${config.name}...`);
        const totalBatches = Math.ceil(config.data.length / BATCH_SIZE);

        for (let i = 0; i < config.data.length; i += BATCH_SIZE) {
          const batch = config.data.slice(i, i + BATCH_SIZE);
          const batchNum = Math.floor(i / BATCH_SIZE) + 1;

          await updateJob({
            progress: {
              current_entity: config.name,
              current_batch: batchNum,
              total_batches: totalBatches,
              processed_rows: totalProcessed + i,
              total_rows: totalRows,
              entities_completed: Array.from(completedEntities)
            }
          });

          await bulkCreateWithRetry(config.name, batch, batchNum, totalBatches);
          
          if (i + BATCH_SIZE < config.data.length) {
            await delay(config.delay);
          }
        }

        // Checkpoint: Mark entity as completed
        completedEntities.add(config.name);
        totalProcessed += config.data.length;
        
        await updateJob({
          checkpoint_payload: {
            ...checkpoint,
            completed_entities: Array.from(completedEntities)
          },
          progress: {
            current_entity: config.name,
            processed_rows: totalProcessed,
            total_rows: totalRows,
            entities_completed: Array.from(completedEntities)
          }
        });

        console.log(`✅ ${config.name} complete (${config.data.length} records)`);
      }

      // PHASE 3: VALIDATION
      console.log('🔍 PHASE 3: Validating...');
      await updateJob({ current_phase: 'validating' });

      const countsAfter = {
        orders: dataSource.orders?.length || 0,
        orderLines: dataSource.orderLines?.length || 0,
        skus: dataSource.skus?.length || 0,
        stores: dataSource.stores?.length || 0,
        purchases: dataSource.purchases?.length || 0,
        purchaseRequests: dataSource.purchaseRequests?.length || 0,
        currentStock: dataSource.currentStock?.length || 0,
        suppliers: dataSource.suppliers?.length || 0,
        stockMovements: dataSource.stockMovements?.length || 0,
        importBatches: dataSource.importBatches?.length || 0,
        importErrors: dataSource.importErrors?.length || 0,
        profitabilityLines: dataSource.profitabilityLines?.length || 0,
        profitabilityBatches: dataSource.profitabilityBatches?.length || 0,
        tasks: dataSource.tasks?.length || 0,
        checklistItems: dataSource.checklistItems?.length || 0,
        comments: dataSource.comments?.length || 0
      };

      // PHASE 4: RECOMPUTE DERIVED DATA
      console.log('🔄 PHASE 4: Recomputing workspace...');
      await updateJob({ current_phase: 'recomputing' });

      try {
        const recomputeResult = await base44.asServiceRole.functions.invoke('recomputeWorkspace', {
          workspaceId: targetWorkspaceId
        });
        console.log('✓ Recompute completed:', recomputeResult.data);
      } catch (recomputeError) {
        console.warn('⚠️ Recompute failed (non-fatal):', recomputeError.message);
      }

      // FINALIZE
      console.log('✨ PHASE 5: Finalizing...');
      await updateJob({
        status: 'completed',
        current_phase: 'finalizing',
        counts_after_restore: countsAfter,
        validation_results: { success: true },
        completed_at: new Date().toISOString()
      });

      console.log('✅ RESTORE COMPLETE');
      return Response.json({ success: true });
    } catch (error) {
      console.error('❌ RESTORE FAILED:', error);
      await updateJob({
        status: 'failed',
        error_log: [
          ...(job.error_log || []),
          {
            timestamp: new Date().toISOString(),
            phase: job.current_phase,
            error_message: error.message,
            retryable: true
          }
        ]
      });
      return Response.json({ error: error.message }, { status: 500 });
    }
  } catch (error) {
    console.error('Execute restore error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});