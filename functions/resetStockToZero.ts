import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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

    // Fetch counts before reset
    const [allCurrentStock, allMovements, workspace] = await Promise.all([
      db.entities.CurrentStock.filter({ tenant_id: workspace_id }),
      db.entities.StockMovement.filter({ tenant_id: workspace_id }),
      db.entities.Tenant.filter({ id: workspace_id })
    ]);

    const skusReset = allCurrentStock.length;
    const movementsDeleted = allMovements.length;

    // Bulk reset all CurrentStock to 0
    if (skusReset > 0) {
      for (const stock of allCurrentStock) {
        await db.entities.CurrentStock.update(stock.id, { quantity_available: 0 });
      }
    }

    // Bulk delete all movements
    if (movementsDeleted > 0) {
      for (const movement of allMovements) {
        await db.entities.StockMovement.delete(movement.id);
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