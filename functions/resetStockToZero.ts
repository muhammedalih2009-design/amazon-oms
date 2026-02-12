import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { workspace_id } = await req.json();
    
    if (!workspace_id) {
      return Response.json({ 
        ok: false,
        error: 'workspace_id is required' 
      }, { status: 400 });
    }

    const db = base44.asServiceRole;

    // Fetch all data for this workspace
    const [allCurrentStock, allMovements, workspace] = await Promise.all([
      db.entities.CurrentStock.filter({ tenant_id: workspace_id }),
      db.entities.StockMovement.filter({ tenant_id: workspace_id }),
      db.entities.Tenant.filter({ id: workspace_id })
    ]);

    let skusReset = 0;
    let movementsDeleted = 0;

    // Sequential processing with retry logic
    const DELAY_MS = 300;
    const MAX_RETRIES = 3;
    
    async function processWithRetry(operation, retries = 0) {
      try {
        await operation();
      } catch (error) {
        if (error.status === 429 && retries < MAX_RETRIES) {
          await delay(1000 * (retries + 1)); // Exponential backoff
          return processWithRetry(operation, retries + 1);
        }
        throw error;
      }
    }

    // Reset all CurrentStock to 0 - one at a time
    for (const stock of allCurrentStock) {
      await processWithRetry(async () => {
        await db.entities.CurrentStock.update(stock.id, { quantity_available: 0 });
      });
      skusReset++;
      await delay(DELAY_MS);
    }

    // Delete all movements - one at a time
    for (const movement of allMovements) {
      await processWithRetry(async () => {
        await db.entities.StockMovement.delete(movement.id);
      });
      movementsDeleted++;
      await delay(DELAY_MS);
    }

    // Update workspace timestamp
    if (workspace.length > 0) {
      await db.entities.Tenant.update(workspace[0].id, {
        last_stock_reset_at: new Date().toISOString()
      });
    }

    return Response.json({
      ok: true,
      skus_reset: skusReset,
      movements_deleted: movementsDeleted
    });

  } catch (error) {
    console.error('Stock reset error:', error);
    return Response.json({ 
      ok: false,
      error: 'Stock reset failed',
      details: error.message 
    }, { status: 500 });
  }
});