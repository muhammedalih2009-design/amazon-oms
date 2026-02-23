import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { jobId } = await req.json();

    if (!jobId) {
      return Response.json({ error: 'Missing jobId' }, { status: 400 });
    }

    // Get all plan items ordered by sort_index
    const planItems = await base44.asServiceRole.entities.TelegramExportPlanItem.filter({
      job_id: jobId
    });

    planItems.sort((a, b) => a.sort_index - b.sort_index);

    // Group by supplier for UI display
    const supplierGroups = {};
    planItems.forEach(item => {
      const supplier = item.supplier_name_display || 'Unknown';
      if (!supplierGroups[supplier]) {
        supplierGroups[supplier] = [];
      }
      supplierGroups[supplier].push({
        id: item.id,
        type: item.item_type,
        sku: item.sku_code,
        product: item.product_name,
        quantity: item.quantity,
        unitCost: item.unit_cost,
        status: item.status,
        sentAt: item.sent_at,
        errorMessage: item.error_message,
        sortIndex: item.sort_index
      });
    });

    return Response.json({
      planItems: planItems.map(p => ({
        id: p.id,
        type: p.item_type,
        supplier: p.supplier_name_display,
        sku: p.sku_code,
        product: p.product_name,
        status: p.status,
        sortIndex: p.sort_index,
        sentAt: p.sent_at,
        errorMessage: p.error_message
      })),
      supplierGroups
    });

  } catch (error) {
    console.error('[Get Plan Details] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});