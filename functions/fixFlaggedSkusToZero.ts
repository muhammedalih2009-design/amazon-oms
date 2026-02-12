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
      
      try {
        console.log(`[fixFlaggedSkus] Processing SKU: ${skuCode}`);
        
        // Find the SKU
        const skus = await db.entities.SKU.filter({ 
          tenant_id: workspace_id, 
          sku_code: skuCode 
        });

        if (skus.length === 0) {
          console.warn(`[fixFlaggedSkus] SKU not found: ${skuCode}`);
          failedCount++;
          failedSkuCodes.push({ sku_code: skuCode, reason: 'SKU not found' });
          continue;
        }

        const sku = skus[0];
        console.log(`[fixFlaggedSkus] Found SKU ID: ${sku.id}`);

        // Get current stock record
        const stockRecords = await db.entities.CurrentStock.filter({ 
          tenant_id: workspace_id, 
          sku_id: sku.id 
        });

        // Reset stock to 0
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

        // Delete all movements for this SKU
        const movements = await db.entities.StockMovement.filter({ 
          tenant_id: workspace_id, 
          sku_id: sku.id 
        });

        console.log(`[fixFlaggedSkus] Deleting ${movements.length} movements for ${skuCode}`);
        
        for (const movement of movements) {
          await db.entities.StockMovement.delete(movement.id);
          await sleep(10); // Small delay between deletions
        }

        processedCount++;
        processedSkuCodes.push(skuCode);
        
        const skuDuration = Date.now() - skuStartTime;
        console.log(`[fixFlaggedSkus] ✓ Completed ${skuCode} in ${skuDuration}ms`);
        
        // Throttle between SKUs
        await sleep(30);
        
      } catch (error) {
        const skuDuration = Date.now() - skuStartTime;
        console.error(`[fixFlaggedSkus] ✗ Failed ${skuCode} after ${skuDuration}ms:`, error.message);
        failedCount++;
        failedSkuCodes.push({ sku_code: skuCode, reason: error.message });
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
      failedSkuCodes: failedCount > 0 ? failedSkuCodes : undefined,
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