import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Canonical function to compute Order COGS from order-level fields or items.
 * Returns { cogs: number | null, source: string, itemsCount: number, itemsCogs: number }
 */
export async function computeOrderCogs(base44, order, workspace_id) {
  // Priority A: Check order-level cost fields
  const orderLevelFields = ['cost', 'total_cost', 'cogs', 'order_cost'];
  for (const field of orderLevelFields) {
    const value = order[field];
    if (typeof value === 'number' && value > 0) {
      return {
        cogs: value,
        source: `order_field:${field}`,
        itemsCount: 0,
        itemsCogs: 0
      };
    }
  }

  // Priority B: Compute from OrderItems
  let items = [];
  try {
    items = await base44.asServiceRole.entities.OrderLine.filter({
      order_id: order.id,
      tenant_id: workspace_id
    });
  } catch (err) {
    console.log(`[COGS] Failed to fetch OrderLines for order ${order.id}: ${err.message}`);
  }

  if (items.length > 0) {
    let itemsCogs = 0;
    for (const item of items) {
      // Check item-level cost fields
      const costValue = item.unit_cost || item.cost || item.cogs || item.avg_cost || item.last_cost;
      const qty = item.quantity || item.qty || 1;
      if (typeof costValue === 'number' && costValue > 0) {
        itemsCogs += costValue * qty;
      }
    }

    if (itemsCogs > 0) {
      return {
        cogs: itemsCogs,
        source: 'items_sum',
        itemsCount: items.length,
        itemsCogs: itemsCogs
      };
    }
  }

  // No cost found anywhere
  return {
    cogs: null,
    source: 'missing',
    itemsCount: items.length,
    itemsCogs: 0
  };
}

Deno.serve(async (req) => {
  // This endpoint can be called to compute COGS for a specific order
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { order_id, workspace_id } = await req.json();

    if (!order_id || !workspace_id) {
      return Response.json({ error: 'order_id and workspace_id required' }, { status: 400 });
    }

    // Verify user has access
    const membership = await base44.asServiceRole.entities.Membership.filter({
      user_id: user.id,
      tenant_id: workspace_id
    });

    if (membership.length === 0) {
      return Response.json({ error: 'No access to workspace' }, { status: 403 });
    }

    // Fetch order
    let order;
    try {
      order = await base44.asServiceRole.entities.Order.get(order_id);
    } catch (err) {
      return Response.json({ error: `Order not found: ${err.message}` }, { status: 404 });
    }

    if (order.tenant_id !== workspace_id) {
      return Response.json({ error: 'Order belongs to different workspace' }, { status: 403 });
    }

    const result = await computeOrderCogs(base44, order, workspace_id);

    return Response.json({
      success: true,
      order_id,
      cogs: result.cogs,
      source: result.source,
      items_count: result.itemsCount,
      items_cogs_sum: result.itemsCogs
    });
  } catch (error) {
    console.error('[computeOrderCogs] ERROR:', error);
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});