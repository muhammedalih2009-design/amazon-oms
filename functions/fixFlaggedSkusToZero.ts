import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

Deno.serve(async (req) => {
  const startTime = Date.now();
  
  try {
    const base44 = createClientFromRequest(req);
    const { workspace_id, sku_codes, batch_size = 50 } = await req.json();
    
    if (!workspace_id) {
      return Response.json({ 
        ok: false,
        error: 'workspace_id is required' 
      }, { status: 400 });
    }

    if (!sku_codes || !Array.isArray(sku_codes) || sku_codes.length === 0) {
      return Response.json({ 
        ok: false,
        error: 'sku_codes array is required' 
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

    console.log(`Processing ${sku_codes.length} flagged SKUs for workspace: ${workspace_id}`);

    let processed = 0;
    let failed = 0;
    const errors = [];

    // Process each SKU one by one with throttling
    for (const skuCode of sku_codes) {
      try {
        // Find the SKU
        const skus = await db.entities.SKU.filter({ 
          tenant_id: workspace_id, 
          sku_code: skuCode 
        });

        if (skus.length === 0) {
          console.warn(`SKU not found: ${skuCode}`);
          failed++;
          continue;
        }

        const sku = skus[0];

        // Get current stock record
        const stockRecords = await db.entities.CurrentStock.filter({ 
          tenant_id: workspace_id, 
          sku_id: sku.id 
        });

        // Reset stock to 0
        if (stockRecords.length > 0) {
          await db.entities.CurrentStock.update(stockRecords[0].id, { 
            quantity_available: 0 
          });
        } else {
          // Create stock record if missing
          await db.entities.CurrentStock.create({
            tenant_id: workspace_id,
            sku_id: sku.id,
            sku_code: skuCode,
            quantity_available: 0
          });
        }

        // Delete all movements for this SKU to clear history
        const movements = await db.entities.StockMovement.filter({ 
          tenant_id: workspace_id, 
          sku_id: sku.id 
        });

        for (const movement of movements) {
          await db.entities.StockMovement.delete(movement.id);
          await sleep(20); // Small delay between deletions
        }

        processed++;
        
        // Throttle to avoid rate limits
        await sleep(50);
        
      } catch (error) {
        console.error(`Failed to process SKU ${skuCode}:`, error.message);
        failed++;
        errors.push({ sku_code: skuCode, error: error.message });
      }
    }

    const tookMs = Date.now() - startTime;
    console.log(`Batch complete: ${processed} processed, ${failed} failed in ${tookMs}ms`);

    return Response.json({
      ok: true,
      processed,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      took_ms: tookMs
    });

  } catch (error) {
    console.error('Fix flagged SKUs error:', error);
    
    return Response.json({ 
      ok: false,
      error: 'Failed to fix flagged SKUs',
      details: error.message
    }, { status: 500 });
  }
});