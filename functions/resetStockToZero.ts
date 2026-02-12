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

    const BATCH_SIZE = 5;
    const DELAY_MS = 200;

    // Reset all CurrentStock to 0
    for (let i = 0; i < allCurrentStock.length; i += BATCH_SIZE) {
      const batch = allCurrentStock.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(stock => db.entities.CurrentStock.update(stock.id, { quantity_available: 0 }))
      );
      skusReset += batch.length;
      if (i + BATCH_SIZE < allCurrentStock.length) {
        await delay(DELAY_MS);
      }
    }

    // Delete all movements
    for (let i = 0; i < allMovements.length; i += BATCH_SIZE) {
      const batch = allMovements.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(movement => db.entities.StockMovement.delete(movement.id))
      );
      movementsDeleted += batch.length;
      if (i + BATCH_SIZE < allMovements.length) {
        await delay(DELAY_MS);
      }
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