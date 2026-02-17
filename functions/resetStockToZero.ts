import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tenantId } = await req.json();

    if (!tenantId) {
      return Response.json({ error: 'Missing tenantId' }, { status: 400 });
    }

    // Fetch all current stock records
    const allStock = await base44.asServiceRole.entities.CurrentStock.filter({ 
      tenant_id: tenantId 
    });

    // Fetch all stock movements for archiving
    const allMovements = await base44.asServiceRole.entities.StockMovement.filter({ 
      tenant_id: tenantId,
      is_archived: false
    });

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Archive all existing movements in batches
    let archivedCount = 0;
    const BATCH_SIZE = 10;
    for (let i = 0; i < allMovements.length; i += BATCH_SIZE) {
      const batch = allMovements.slice(i, i + BATCH_SIZE);
      for (const movement of batch) {
        await base44.asServiceRole.entities.StockMovement.update(movement.id, {
          is_archived: true
        });
        archivedCount++;
      }
      if (i + BATCH_SIZE < allMovements.length) {
        await delay(500); // 500ms between batches
      }
    }

    // Reset all stock to 0 in batches
    let affectedSkus = 0;
    for (let i = 0; i < allStock.length; i += BATCH_SIZE) {
      const batch = allStock.slice(i, i + BATCH_SIZE);
      for (const stock of batch) {
        await base44.asServiceRole.entities.CurrentStock.update(stock.id, {
          quantity_available: 0
        });
        affectedSkus++;

        // Create baseline movement record
        await base44.asServiceRole.entities.StockMovement.create({
          tenant_id: tenantId,
          sku_id: stock.sku_id,
          sku_code: stock.sku_code,
          movement_type: 'reset_baseline',
          quantity: 0,
          reference_type: 'manual',
          reference_id: 'reset_operation',
          movement_date: new Date().toISOString().split('T')[0],
          notes: 'Stock reset to zero - baseline created',
          is_archived: false
        });
      }
      if (i + BATCH_SIZE < allStock.length) {
        await delay(500); // 500ms between batches
      }
    }

    return Response.json({
      success: true,
      archived_movements_count: archivedCount,
      affected_skus: affectedSkus
    });

  } catch (error) {
    console.error('Reset stock error:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});