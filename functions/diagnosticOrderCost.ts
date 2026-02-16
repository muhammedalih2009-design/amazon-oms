import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id, import_id } = await req.json();

    // Step 1: Get workspace data inventory
    const allRows = await base44.asServiceRole.entities.SettlementRow.filter({
      tenant_id: workspace_id
    });
    
    const allOrders = await base44.asServiceRole.entities.Order.filter({
      tenant_id: workspace_id
    });

    const allImports = await base44.asServiceRole.entities.SettlementImport.filter({
      tenant_id: workspace_id
    });

    console.log(`[DIAGNOSTIC] Workspace inventory:`, {
      total_settlement_rows: allRows.length,
      total_orders: allOrders.length,
      total_imports: allImports.length
    });

    // Step 2: Check if data exists at all
    if (allRows.length === 0) {
      return Response.json({
        success: false,
        status: 'NO_DATA',
        message: 'No settlement rows in workspace',
        inventory: {
          settlement_rows: 0,
          orders: allOrders.length,
          imports: allImports.length
        },
        next_steps: 'Upload a settlement file via the Settlement > Import Settlement tab'
      });
    }

    // Step 3: Load and filter rows based on import_id
    let rowsToAnalyze = allRows.filter(r => !r.is_deleted);
    if (import_id) {
      rowsToAnalyze = rowsToAnalyze.filter(r => r.settlement_import_id === import_id);
    }

    console.log(`[DIAGNOSTIC] Rows to analyze: ${rowsToAnalyze.length} (deleted: ${allRows.filter(r => r.is_deleted).length})`);

    if (rowsToAnalyze.length === 0) {
      return Response.json({
        success: false,
        status: 'NO_ACTIVE_ROWS',
        message: import_id ? 'No active rows in selected import' : 'All settlement rows are deleted',
        inventory: {
          settlement_rows: allRows.length,
          active_rows: 0,
          deleted_rows: allRows.filter(r => r.is_deleted).length,
          orders: allOrders.length,
          imports: allImports.length
        },
        next_steps: import_id ? 'Select a different import or check if rows were deleted' : 'Restore deleted rows or upload new settlement data'
      });
    }

    // Step 4: Analyze matched vs unmatched
    const matchedRows = rowsToAnalyze.filter(r => r.matched_order_id && (r.match_status === 'matched' || r.match_status === 'unmatched_sku'));
    const unmatchedRows = rowsToAnalyze.filter(r => !r.matched_order_id || r.match_status === 'unmatched_order');

    console.log(`[DIAGNOSTIC] Match status:`, {
      matched: matchedRows.length,
      unmatched: unmatchedRows.length
    });

    if (matchedRows.length === 0) {
      return Response.json({
        success: false,
        status: 'ALL_UNMATCHED',
        message: 'No matched orders in settlement data',
        inventory: {
          settlement_rows: allRows.length,
          active_rows: rowsToAnalyze.length,
          matched_rows: 0,
          unmatched_rows: unmatchedRows.length,
          orders: allOrders.length
        },
        sample_unmatched: unmatchedRows.slice(0, 3).map(r => ({
          order_id: r.order_id,
          reason: r.not_found_reason
        })),
        next_steps: 'Run "Rematch Orders" in Settlement > Orders tab to match settlement data to order records'
      });
    }

    // Step 5: Sample a matched row and check order cost data
    const sampleRow = matchedRows[0];
    let sampleOrder;
    try {
      sampleOrder = await base44.asServiceRole.entities.Order.get(sampleRow.matched_order_id);
    } catch (err) {
      console.error('[DIAGNOSTIC] Failed to fetch sample order:', err);
      return Response.json({
        success: false,
        status: 'ORDER_FETCH_FAILED',
        message: `Could not fetch matched order ${sampleRow.matched_order_id}`,
        error: err.message
      }, { status: 500 });
    }

    // Step 6: Analyze cost data quality
    const ordersWithCost = allOrders.filter(o => o.total_cost && o.total_cost > 0).length;
    const ordersWithoutCost = allOrders.filter(o => !o.total_cost || o.total_cost === 0).length;

    console.log(`[DIAGNOSTIC] Order cost analysis:`, {
      total_orders: allOrders.length,
      with_cost: ordersWithCost,
      without_cost: ordersWithoutCost
    });

    return Response.json({
      success: true,
      status: 'DIAGNOSTIC_COMPLETE',
      inventory: {
        settlement_rows: allRows.length,
        active_rows: rowsToAnalyze.length,
        deleted_rows: allRows.filter(r => r.is_deleted).length,
        matched_rows: matchedRows.length,
        unmatched_rows: unmatchedRows.length,
        orders: allOrders.length,
        orders_with_cost: ordersWithCost,
        orders_without_cost: ordersWithoutCost,
        imports: allImports.length
      },
      sample_matched_row: {
        order_id: sampleRow.order_id,
        matched_order_id: sampleRow.matched_order_id,
        match_status: sampleRow.match_status,
        match_strategy: sampleRow.match_strategy
      },
      sample_order: {
        id: sampleOrder.id,
        amazon_order_id: sampleOrder.amazon_order_id,
        total_cost: sampleOrder.total_cost,
        net_revenue: sampleOrder.net_revenue,
        profit_loss: sampleOrder.profit_loss
      },
      cost_data_issue: ordersWithoutCost > 0 ? {
        description: `${ordersWithoutCost} orders have no cost data`,
        impact: 'Cost (COGS) column will show $0.00 for these orders',
        solution: 'Click "Recompute COGS" in Settlement > Orders tab'
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