/**
 * Atomic Stock Reset Function
 * Resets all stock to zero and archives movement history
 * Runs in a single atomic operation - all or nothing
 */

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
  
  try {
    // Fetch all workspace data
    const [allSKUs, allMovements, allCurrentStock] = await Promise.all([
      db.entities.SKU.filter({ tenant_id: workspace_id }),
      db.entities.StockMovement.filter({ tenant_id: workspace_id }),
      db.entities.CurrentStock.filter({ tenant_id: workspace_id })
    ]);

    const timestamp = new Date().toISOString();
    let skusReset = 0;
    let movementsArchived = 0;
    let movementsDeleted = 0;

    // Step 1: Set all current stock to 0 (enforces non-negative constraint)
    for (const stock of allCurrentStock) {
      await db.entities.CurrentStock.update(stock.id, {
        quantity_available: 0
      });
      skusReset++;
    }

    // Step 2: Archive movements by setting is_archived=true (acts as archive table)
    for (const movement of allMovements) {
      if (!movement.is_archived) {
        await db.entities.StockMovement.update(movement.id, {
          is_archived: true
        });
        movementsArchived++;
      }
    }

    // Step 3: Delete archived movements (clean slate)
    for (const movement of allMovements) {
      await db.entities.StockMovement.delete(movement.id);
      movementsDeleted++;
    }

    // Step 4: Update workspace with reset timestamp
    await db.entities.Tenant.update(workspace_id, {
      last_stock_reset_at: timestamp
    });

    // Return success summary
    return Response.json({
      ok: true,
      skus_reset: skusReset,
      movements_archived: movementsArchived,
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