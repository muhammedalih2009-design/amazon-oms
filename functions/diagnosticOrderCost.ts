import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id, import_id } = await req.json();

    // Get a matched settlement row
    const query = {
      tenant_id: workspace_id,
      is_deleted: false
    };
    if (import_id) {
      query.settlement_import_id = import_id;
    }

    const matchedRows = await base44.asServiceRole.entities.SettlementRow.filter(query);

    if (matchedRows.length === 0) {
      // Debug: check what's available
      const allRows = await base44.asServiceRole.entities.SettlementRow.filter({
        tenant_id: workspace_id
      });
      const notDeletedRows = await base44.asServiceRole.entities.SettlementRow.filter({
        tenant_id: workspace_id,
        is_deleted: false
      });
      
      return Response.json({ 
        error: 'No settlement rows found with query',
        debug: {
          query_used: query,
          total_rows_all: allRows.length,
          total_rows_not_deleted: notDeletedRows.length,
          sample_row: notDeletedRows[0] ? {
            id: notDeletedRows[0].id,
            is_deleted: notDeletedRows[0].is_deleted,
            matched_order_id: notDeletedRows[0].matched_order_id
          } : null
        }
      }, { status: 400 });
    }

    const row = matchedRows[0];
    console.log('[DIAGNOSTIC] Settlement row:', {
      order_id: row.order_id,
      matched_order_id: row.matched_order_id,
      match_status: row.match_status
    });

    if (!row.matched_order_id) {
      return Response.json({ error: 'No matched_order_id in row' }, { status: 400 });
    }

    // Fetch the Order directly using .get()
    let order;
    try {
      order = await base44.asServiceRole.entities.Order.get(row.matched_order_id);
    } catch (err) {
      console.error('[DIAGNOSTIC] Failed to fetch Order:', err.message);
      return Response.json({ 
        error: `Failed to fetch Order ${row.matched_order_id}: ${err.message}`,
        settlement_row: row
      }, { status: 500 });
    }

    console.log('[DIAGNOSTIC] Raw Order from .get():', {
      id: order.id,
      amazon_order_id: order.amazon_order_id,
      total_cost: order.total_cost,
      net_revenue: order.net_revenue,
      profit_loss: order.profit_loss,
      all_fields: Object.keys(order),
      full_object: order
    });

    // Also try filter
    const filteredOrders = await base44.asServiceRole.entities.Order.filter({
      tenant_id: workspace_id,
      id: row.matched_order_id
    });

    console.log('[DIAGNOSTIC] Order via .filter():', {
      found: filteredOrders.length > 0,
      order: filteredOrders[0]
    });

    return Response.json({
      success: true,
      settlement_row_sample: {
        order_id: row.order_id,
        matched_order_id: row.matched_order_id,
        match_status: row.match_status
      },
      order_via_get: {
        id: order.id,
        amazon_order_id: order.amazon_order_id,
        total_cost: order.total_cost,
        net_revenue: order.net_revenue,
        profit_loss: order.profit_loss,
        full_object: JSON.stringify(order, null, 2)
      },
      order_via_filter: filteredOrders.length > 0 ? {
        total_cost: filteredOrders[0].total_cost,
        net_revenue: filteredOrders[0].net_revenue
      } : null
    });
  } catch (error) {
    console.error('[diagnosticOrderCost] ERROR:', error);
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});