import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { tenantId } = await req.json();

    if (!tenantId) {
      return Response.json({ error: 'Missing tenantId' }, { status: 400 });
    }

    // Fetch all entities and count
    const entities = {
      'SKU': await base44.asServiceRole.entities.SKU.filter({ tenant_id: tenantId }),
      'Order': await base44.asServiceRole.entities.Order.filter({ tenant_id: tenantId }),
      'OrderLine': await base44.asServiceRole.entities.OrderLine.filter({ tenant_id: tenantId }),
      'Purchase': await base44.asServiceRole.entities.Purchase.filter({ tenant_id: tenantId }),
      'Supplier': await base44.asServiceRole.entities.Supplier.filter({ tenant_id: tenantId }),
      'StockMovement': await base44.asServiceRole.entities.StockMovement.filter({ tenant_id: tenantId }),
      'Store': await base44.asServiceRole.entities.Store.filter({ tenant_id: tenantId }),
      'CurrentStock': await base44.asServiceRole.entities.CurrentStock.filter({ tenant_id: tenantId }),
      'ImportBatch': await base44.asServiceRole.entities.ImportBatch.filter({ tenant_id: tenantId }),
      'Task': await base44.asServiceRole.entities.Task.filter({ tenant_id: tenantId }),
      'TaskChecklistItem': await base44.asServiceRole.entities.TaskChecklistItem.filter({}),
      'TaskComment': await base44.asServiceRole.entities.TaskComment.filter({}),
      'Return': await base44.asServiceRole.entities.Return.filter({ tenant_id: tenantId })
    };

    const counts = Object.entries(entities).reduce((acc, [name, data]) => {
      acc[name] = (data || []).length;
      return acc;
    }, {});

    return Response.json({
      tenantId,
      timestamp: new Date().toISOString(),
      liveRecordCounts: counts,
      totalRecords: Object.values(counts).reduce((a, b) => a + b, 0)
    });
  } catch (error) {
    console.error('Verify backup completeness error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});