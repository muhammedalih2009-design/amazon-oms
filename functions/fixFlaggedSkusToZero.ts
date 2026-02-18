import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

Deno.serve(async (req) => {
  const startTime = Date.now();
  
  try {
    const base44 = createClientFromRequest(req);
    const { workspace_id, sku_codes, start_index = 0, batch_size = 25 } = await req.json();
    
    console.log(`[fixFlaggedSkus] START - Workspace: ${workspace_id}, Start: ${start_index}, BatchSize: ${batch_size}, Total SKUs: ${sku_codes?.length || 0}`);
    
    if (!workspace_id) {
      return Response.json({ 
        ok: false,
        error: 'workspace_id is required' 
      }, { status: 400 });
    }

    if (!sku_codes || !Array.isArray(sku_codes) || sku_codes.length === 0) {
      return Response.json({ 
        ok: false,
        error: 'sku_codes array is required and cannot be empty' 
      }, { status: 400 });
    }

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ 
        ok: false,
        error: 'Unauthorized' 
      }, { status: 401 });
    }

    const db = base44.asServiceRole;

    // Get batch to process
    const endIndex = Math.min(start_index + batch_size, sku_codes.length);
    const batchSkuCodes = sku_codes.slice(start_index, endIndex);
    
    console.log(`[fixFlaggedSkus] Processing batch: ${start_index} to ${endIndex} (${batchSkuCodes.length} SKUs)`);

    let processedCount = 0;
    let failedCount = 0;
    const processedSkuCodes = [];
    const failedSkuCodes = [];

    // Process each SKU in batch
    for (const skuCode of batchSkuCodes) {
      const skuStartTime = Date.now();
      let step = 'init';
      
      try {
        console.log(`[fixFlaggedSkus] Processing SKU: ${skuCode}`);
        
        // STEP 1: Find the SKU
        step = 'read_sku_record';
        const skus = await db.entities.SKU.filter({ 
          tenant_id: workspace_id, 
          sku_code: skuCode 
        });

        if (skus.length === 0) {
          console.warn(`[fixFlaggedSkus] SKU not found: ${skuCode}`);
          failedCount++;
          failedSkuCodes.push({ 
            sku_code: skuCode, 
            error_code: 'SKU_NOT_FOUND',
            reason: 'SKU record not found in database',
            details: `No SKU with code "${skuCode}" exists in workspace ${workspace_id}`,
            step: 'read_sku_record'
          });
          continue;
        }

        const sku = skus[0];
        console.log(`[fixFlaggedSkus] Found SKU ID: ${sku.id}`);

        // STEP 2: Get current stock record
        step = 'read_stock_record';
        const stockRecords = await db.entities.CurrentStock.filter({ 
          tenant_id: workspace_id, 
          sku_id: sku.id 
        });

        // STEP 3: Reset stock to 0
        step = 'update_stock';
        try {
          if (stockRecords.length > 0) {
            console.log(`[fixFlaggedSkus] Updating stock to 0 for ${skuCode}`);
            await db.entities.CurrentStock.update(stockRecords[0].id, { 
              quantity_available: 0 
            });
          } else {
            console.log(`[fixFlaggedSkus] Creating stock record at 0 for ${skuCode}`);
            await db.entities.CurrentStock.create({
              tenant_id: workspace_id,
              sku_id: sku.id,
              sku_code: skuCode,
              quantity_available: 0
            });
          }
        } catch (stockError) {
          console.error(`[fixFlaggedSkus] Stock update failed for ${skuCode}:`, stockError.message);
          failedCount++;
          failedSkuCodes.push({ 
            sku_code: skuCode, 
            error_code: 'DB_WRITE_FAILED',
            reason: 'Failed to update stock record',
            details: stockError.message,
            step: 'update_stock'
          });
          continue;
        }

        // STEP 4: Archive all movements for this SKU with retry
        step = 'archive_movements';
        await sleep(150); // Pre-delay
        
        retries = 0;
        let movements;
        while (retries < 3) {
          try {
            movements = await db.entities.StockMovement.filter({ 
              tenant_id: workspace_id, 
              sku_id: sku.id,
              is_archived: false
            });
            break;
          } catch (err) {
            if (err.message?.includes('rate limit') && retries < 2) {
              retries++;
              await sleep(1000 * retries);
              continue;
            }
            throw err;
          }
        }

        console.log(`[fixFlaggedSkus] Archiving ${movements.length} movements for ${skuCode}`);
        
        // Batch archive movements with retry
        const MOVEMENT_BATCH_SIZE = 5; // Smaller batch for rate limit
        for (let i = 0; i < movements.length; i += MOVEMENT_BATCH_SIZE) {
          const batch = movements.slice(i, i + MOVEMENT_BATCH_SIZE);
          retries = 0;
          while (retries < 3) {
            try {
              await Promise.all(batch.map(movement => 
                db.entities.StockMovement.update(movement.id, { is_archived: true })
              ));
              await sleep(200); // Increased delay between batches
              break;
            } catch (archiveError) {
              if (archiveError.message?.includes('rate limit') && retries < 2) {
                retries++;
                await sleep(1500 * retries);
                continue;
              }
              console.error(`[fixFlaggedSkus] Failed to archive movement batch for ${skuCode}:`, archiveError.message);
              break; // Continue with next batch
            }
          }
        }

        processedCount++;
        processedSkuCodes.push(skuCode);
        
        const skuDuration = Date.now() - skuStartTime;
        console.log(`[fixFlaggedSkus] ✓ Completed ${skuCode} in ${skuDuration}ms`);
        
        // Throttle between SKUs (increased significantly for rate limit)
        await sleep(300);
        
      } catch (error) {
        const skuDuration = Date.now() - skuStartTime;
        console.error(`[fixFlaggedSkus] ✗ Failed ${skuCode} at step "${step}" after ${skuDuration}ms:`, error.message);
        
        // Determine error code based on error type
        let errorCode = 'UNKNOWN_ERROR';
        if (error.message?.toLowerCase().includes('timeout')) {
          errorCode = 'TIMEOUT';
        } else if (error.message?.toLowerCase().includes('rate limit')) {
          errorCode = 'RATE_LIMIT';
        } else if (step === 'read_sku_record') {
          errorCode = 'SKU_READ_FAILED';
        } else if (step === 'update_stock') {
          errorCode = 'DB_WRITE_FAILED';
        } else if (step === 'archive_movements') {
          errorCode = 'MOVEMENT_ARCHIVE_FAILED';
        }
        
        failedCount++;
        failedSkuCodes.push({ 
          sku_code: skuCode, 
          error_code: errorCode,
          reason: `Failed at step: ${step}`,
          details: error.message,
          step
        });
      }
    }

    const nextIndex = endIndex;
    const done = nextIndex >= sku_codes.length;
    const tookMs = Date.now() - startTime;

    console.log(`[fixFlaggedSkus] BATCH COMPLETE - Processed: ${processedCount}, Failed: ${failedCount}, Next: ${nextIndex}/${sku_codes.length}, Done: ${done}, Duration: ${tookMs}ms`);

    return Response.json({
      ok: true,
      processedCount,
      failedCount,
      totalCount: sku_codes.length,
      processedSkuCodes,
      failed: failedCount > 0 ? failedSkuCodes : [],
      nextIndex,
      done,
      took_ms: tookMs
    });

  } catch (error) {
    const tookMs = Date.now() - startTime;
    console.error(`[fixFlaggedSkus] ERROR after ${tookMs}ms:`, error);
    
    return Response.json({ 
      ok: false,
      error: 'Failed to fix flagged SKUs',
      details: error.message,
      took_ms: tookMs
    }, { status: 500 });
  }
});