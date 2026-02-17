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

    // Archive all existing movements
    let archivedCount = 0;
    for (const movement of allMovements) {
      await base44.asServiceRole.entities.StockMovement.update(movement.id, {
        is_archived: true
      });
      archivedCount++;
    }

    // Reset all stock to 0
    let affectedSkus = 0;
    for (const stock of allStock) {
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