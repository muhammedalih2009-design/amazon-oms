import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

Deno.serve(async (req) => {
  const startTime = Date.now();
  
  try {
    const base44 = createClientFromRequest(req);
    const { workspace_id } = await req.json();
    
    if (!workspace_id) {
      return Response.json({ 
        ok: false,
        error: 'workspace_id is required' 
      }, { status: 400 });
    }

    // Verify user is authenticated
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ 
        ok: false,
        error: 'Unauthorized' 
      }, { status: 401 });
    }

    const db = base44.asServiceRole;

    console.log('Starting full stock reset for workspace:', workspace_id);

    // Step 1: Fetch all records for this workspace
    const [allCurrentStock, allMovements, workspace] = await Promise.all([
      db.entities.CurrentStock.filter({ tenant_id: workspace_id }),
      db.entities.StockMovement.filter({ tenant_id: workspace_id }),
      db.entities.Tenant.filter({ id: workspace_id })
    ]);

    console.log(`Found ${allCurrentStock.length} stock records and ${allMovements.length} movements`);

    let skusReset = 0;
    let movementsProcessed = 0;

    // Step 2: Reset all CurrentStock to 0 (with chunking and throttling)
    const CHUNK_SIZE = 50;
    const DELAY_BETWEEN_CHUNKS = 1000; // 1 second delay between chunks
    
    for (let i = 0; i < allCurrentStock.length; i += CHUNK_SIZE) {
      const chunk = allCurrentStock.slice(i, i + CHUNK_SIZE);
      
      // Process chunk sequentially to avoid rate limits
      for (const stock of chunk) {
        try {
          await db.entities.CurrentStock.update(stock.id, { quantity_available: 0 });
          skusReset++;
        } catch (error) {
          console.error(`Failed to reset stock for ${stock.sku_code}:`, error.message);
          // Continue with next item even if one fails
        }
        
        // Small delay between each update to avoid rate limits
        await sleep(50);
      }
      
      console.log(`Progress: Reset ${skusReset}/${allCurrentStock.length} SKUs`);
      
      // Delay between chunks
      if (i + CHUNK_SIZE < allCurrentStock.length) {
        await sleep(DELAY_BETWEEN_CHUNKS);
      }
    }

    // Step 3: Delete all movements (with chunking and throttling)
    for (let i = 0; i < allMovements.length; i += CHUNK_SIZE) {
      const chunk = allMovements.slice(i, i + CHUNK_SIZE);
      
      // Process chunk sequentially to avoid rate limits
      for (const movement of chunk) {
        try {
          await db.entities.StockMovement.delete(movement.id);
          movementsProcessed++;
        } catch (error) {
          console.error(`Failed to delete movement ${movement.id}:`, error.message);
          // Continue with next item even if one fails
        }
        
        // Small delay between each deletion
        await sleep(50);
      }
      
      console.log(`Progress: Deleted ${movementsProcessed}/${allMovements.length} movements`);
      
      // Delay between chunks
      if (i + CHUNK_SIZE < allMovements.length) {
        await sleep(DELAY_BETWEEN_CHUNKS);
      }
    }

    // Step 4: Update workspace timestamp
    if (workspace.length > 0) {
      await db.entities.Tenant.update(workspace[0].id, {
        last_stock_reset_at: new Date().toISOString()
      });
    }

    const tookMs = Date.now() - startTime;
    console.log(`Reset complete in ${tookMs}ms`);

    return Response.json({
      ok: true,
      skus_reset: skusReset,
      movements_deleted: movementsProcessed,
      took_ms: tookMs
    });

  } catch (error) {
    console.error('Stock reset error:', error);
    
    // Return detailed error message
    const errorMessage = error.message || 'Unknown error';
    const errorDetails = error.data?.message || error.data?.detail || errorMessage;
    
    return Response.json({ 
      ok: false,
      error: 'Stock reset failed',
      details: errorDetails,
      hint: 'Check the function logs in Dashboard → Code → Functions → resetStockToZero'
    }, { status: 500 });
  }
});