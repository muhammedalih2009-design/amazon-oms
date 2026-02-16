import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const COGS_SOURCE = {
  ORDER_TOTAL: 'ORDER_TOTAL',
  ORDER_LINE_TOTAL: 'ORDER_LINE_TOTAL',
  ORDER_LINES_SKU_COST: 'ORDER_LINES_SKU_COST',
  MISSING: 'MISSING'
};

const COGS_REASON = {
  SUCCESS: 'Success',
  ORDER_TOTAL_ZERO: 'Order.total_cost is zero',
  ORDER_LINES_MISSING: 'No order lines found',
  SKU_COST_MISSING: 'SKU cost_price missing',
  ORDER_FOUND_COST_MISSING: 'Order matched but COGS missing'
};

const DEBUG_ORDER_IDS = [
  '406-9098319-4354700',
  '405-9237140-1177144',
  '407-7729567-8966740',
  '171-1927461-9022731'
];

function computeCanonicalCOGS(matchedOrder, orderLines, skus) {
  // Priority A: Order.total_cost if > 0
  if (matchedOrder.total_cost && matchedOrder.total_cost > 0) {
    return {
      cogs: matchedOrder.total_cost,
      source: COGS_SOURCE.ORDER_TOTAL,
      reason: COGS_REASON.SUCCESS
    };
  }

  // Priority B: Sum(OrderLine.line_total_cost) if available
  const lines = orderLines.filter(l => l.order_id === matchedOrder.id);
  if (lines.length > 0) {
    let lineTotalCost = 0;
    let hasLineTotalCost = false;

    for (const line of lines) {
      if (line.line_total_cost && line.line_total_cost > 0) {
        lineTotalCost += line.line_total_cost;
        hasLineTotalCost = true;
      }
    }

    if (hasLineTotalCost && lineTotalCost > 0) {
      return {
        cogs: lineTotalCost,
        source: COGS_SOURCE.ORDER_LINE_TOTAL,
        reason: COGS_REASON.SUCCESS,
        should_sync_to_order: true
      };
    }

    // Priority C: Sum(OrderLine.quantity * SKU.cost_price)
    let totalCost = 0;
    let allSkusHaveCost = true;

    for (const line of lines) {
      const sku = skus.find(s => s.id === line.sku_id);
      if (sku && sku.cost_price) {
        totalCost += (line.quantity || 0) * sku.cost_price;
      } else {
        allSkusHaveCost = false;
      }
    }

    if (totalCost > 0) {
      return {
        cogs: totalCost,
        source: COGS_SOURCE.ORDER_LINES_SKU_COST,
        reason: allSkusHaveCost ? COGS_REASON.SUCCESS : COGS_REASON.SKU_COST_MISSING,
        should_sync_to_order: true
      };
    }

    return {
      cogs: 0,
      source: COGS_SOURCE.MISSING,
      reason: allSkusHaveCost ? COGS_REASON.ORDER_LINES_MISSING : COGS_REASON.SKU_COST_MISSING
    };
  }

  // Priority D: No order lines
  return {
    cogs: 0,
    source: COGS_SOURCE.MISSING,
    reason: COGS_REASON.ORDER_FOUND_COST_MISSING
  };
}

Deno.serve(async (req) => {
  const DEPLOYMENT_V = 'v4.0.0-' + Date.now();
  const START_TIME = Date.now();
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const reqBody = await req.json();
    const { workspace_id, import_id } = reqBody;
    
    console.log(`[DEPLOYMENT] ${DEPLOYMENT_V}`);
    console.log(`[REQUEST] Payload:`, { workspace_id, import_id, user_id: user.id });

    if (!workspace_id) {
      return Response.json({ error: 'workspace_id required' }, { status: 400 });
    }

    const membership = await base44.asServiceRole.entities.Membership.filter({
      tenant_id: workspace_id,
      user_id: user.id
    });

    if (membership.length === 0) {
      return Response.json({ error: 'No access to workspace' }, { status: 403 });
    }

    const [orders, orderLines, skus] = await Promise.all([
      base44.asServiceRole.entities.Order.filter({ tenant_id: workspace_id, is_deleted: false }),
      base44.asServiceRole.entities.OrderLine.filter({ tenant_id: workspace_id }),
      base44.asServiceRole.entities.SKU.filter({ tenant_id: workspace_id })
    ]);

    console.log(`[DATA] Orders: ${orders.length} | OrderLines: ${orderLines.length} | SKUs: ${skus.length}`);

    // Load settlement rows
    let rowsToRecompute = [];
    if (import_id) {
      rowsToRecompute = await base44.asServiceRole.entities.SettlementRow.filter({
        tenant_id: workspace_id,
        settlement_import_id: import_id,
        is_deleted: false
      });
    } else {
      rowsToRecompute = await base44.asServiceRole.entities.SettlementRow.filter({
        tenant_id: workspace_id,
        is_deleted: false
      });
    }

    console.log(`[ROWS] Total settlement rows scanned: ${rowsToRecompute.length}`);
    
    // Log sample of rows
    const sampleRows = rowsToRecompute.slice(0, 3);
    console.log(`[ROWS SAMPLE]:`, sampleRows.map(r => ({
      order_id: r.order_id,
      matched_order_id: r.matched_order_id,
      match_status: r.match_status
    })));

    // Filter for matched rows only
    const matchedRows = rowsToRecompute.filter(row => 
      row.matched_order_id && 
      (row.match_status === 'matched' || row.match_status === 'unmatched_sku')
    );

    console.log(`[ROWS] Eligible rows (with matched_order_id): ${matchedRows.length}`);

    if (matchedRows.length === 0) {
      const unmatchedCount = rowsToRecompute.filter(r => !r.matched_order_id).length;
      console.log(`[ERROR] NO ELIGIBLE ROWS - Total: ${rowsToRecompute.length}, Unmatched: ${unmatchedCount}`);
      return Response.json({
        success: false,
        error_code: 'NO_ELIGIBLE_MATCHED_ROWS',
        total_rows_scanned: rowsToRecompute.length,
        eligible_rows: 0,
        matched_order_rows_scanned: 0,
        rows_updated: 0,
        rows_with_cogs: 0,
        rows_missing_cogs: 0,
        message: 'No matched settlement rows found for COGS recomputation'
      });
    }

    const results = {
      total_rows_scanned: rowsToRecompute.length,
      matched_order_rows_scanned: matchedRows.length,
      rows_with_cogs: 0,
      rows_missing_cogs: 0,
      cogs_by_source: {
        ORDER_TOTAL: 0,
        ORDER_LINE_TOTAL: 0,
        ORDER_LINES_SKU_COST: 0,
        MISSING: 0
      },
      orders_synced: 0,
      debug_orders: []
    };

    const rowUpdates = [];
    const orderUpdates = new Map();
    const skippedReasons = {};
    let processedCount = 0;

    for (const row of matchedRows) {
      const matchedOrder = orders.find(o => o.id === row.matched_order_id);
      if (!matchedOrder) {
        skippedReasons['ORDER_NOT_FOUND'] = (skippedReasons['ORDER_NOT_FOUND'] || 0) + 1;
        console.warn(`[SKIP] Row ${row.order_id}: Matched order ID not found: ${row.matched_order_id}`);
        continue;
      }

      const orderTotalCostBefore = matchedOrder.total_cost || 0;
      const orderLinesForOrder = orderLines.filter(l => l.order_id === matchedOrder.id);
      const cogsResult = computeCanonicalCOGS(matchedOrder, orderLines, skus);

      processedCount++;

      // DEBUG: Track specific orders
      const isDebugOrder = DEBUG_ORDER_IDS.includes(row.order_id);
      if (isDebugOrder) {
        results.debug_orders.push({
          order_id: row.order_id,
          matched_order_id: row.matched_order_id,
          order_total_cost_before: orderTotalCostBefore,
          order_total_cost_after: cogsResult.should_sync_to_order ? cogsResult.cogs : orderTotalCostBefore,
          order_lines_count: orderLinesForOrder.length,
          row_cogs_before: 0,
          row_cogs_after: cogsResult.cogs,
          cogs_source: cogsResult.source,
          cogs_reason: cogsResult.reason
        });
        console.log(`[DEBUG] ${row.order_id}:`, results.debug_orders[results.debug_orders.length - 1]);
      }

      // Update settlement row with COGS metadata
      rowUpdates.push({
        id: row.id,
        data: {
          not_found_reason: cogsResult.reason !== COGS_REASON.SUCCESS ? cogsResult.reason : null
        }
      });

      // Sync Order.total_cost if missing and we computed COGS from lines
      if (cogsResult.should_sync_to_order && orderTotalCostBefore === 0 && cogsResult.cogs > 0) {
        if (!orderUpdates.has(matchedOrder.id)) {
          orderUpdates.set(matchedOrder.id, {
            id: matchedOrder.id,
            total_cost: cogsResult.cogs,
            profit_loss: (matchedOrder.net_revenue || 0) - cogsResult.cogs,
            profit_margin_percent: matchedOrder.net_revenue 
              ? ((matchedOrder.net_revenue - cogsResult.cogs) / matchedOrder.net_revenue) * 100 
              : 0
          });
        }
      }

      if (cogsResult.cogs > 0) {
        results.rows_with_cogs++;
      } else {
        results.rows_missing_cogs++;
      }

      results.cogs_by_source[cogsResult.source]++;
    }

    console.log(`[PROCESSING] Processed: ${processedCount} | Updated: ${rowUpdates.length} | Skipped:`, skippedReasons);

    console.log(`[UPDATES] Settlement rows to update: ${rowUpdates.length}`);
    console.log(`[UPDATES] Orders to sync: ${orderUpdates.size}`);

    // Apply settlement row updates in batches
    const BATCH_SIZE = 50;
    for (let i = 0; i < rowUpdates.length; i += BATCH_SIZE) {
      const batch = rowUpdates.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(item => 
          base44.asServiceRole.entities.SettlementRow.update(item.id, item.data)
        )
      );
    }

    // Apply order updates
    for (const [orderId, updateData] of orderUpdates) {
      await base44.asServiceRole.entities.Order.update(orderId, updateData);
      results.orders_synced++;
    }

    console.log(`[SYNC] Updated ${results.orders_synced} orders with computed COGS`);

    // Recompute import totals
    let importsUpdated = 0;
    if (import_id) {
      const importRows = await base44.asServiceRole.entities.SettlementRow.filter({
        settlement_import_id: import_id,
        is_deleted: false
      });

      const totalRevenue = importRows.reduce((sum, r) => sum + (r.total || 0), 0);
      let totalCogs = 0;

      // Reload orders to get updated costs
      const freshOrders = await base44.asServiceRole.entities.Order.filter({ 
        tenant_id: workspace_id, 
        is_deleted: false 
      });

      for (const row of importRows) {
        if (row.matched_order_id) {
          const matchedOrder = freshOrders.find(o => o.id === row.matched_order_id);
          if (matchedOrder) {
            const cogsResult = computeCanonicalCOGS(matchedOrder, orderLines, skus);
            // Proportional COGS allocation based on quantity
            const orderTotalQty = Math.abs(matchedOrder.net_revenue || 1);
            totalCogs += cogsResult.cogs * (Math.abs(row.signed_qty) / orderTotalQty);
          }
        }
      }

      const totalProfit = totalRevenue - totalCogs;
      const margin = totalRevenue !== 0 ? (totalProfit / totalRevenue) : 0;

      await base44.asServiceRole.entities.SettlementImport.update(import_id, {
        totals_cached_json: {
          total_revenue: totalRevenue,
          total_cogs: totalCogs,
          total_profit: totalProfit,
          margin: margin,
          orders_count: new Set(importRows.map(r => r.order_id)).size,
          skus_count: new Set(importRows.map(r => r.sku)).size
        }
      });

      importsUpdated = 1;
      console.log(`[IMPORT] Updated totals - COGS: $${totalCogs.toFixed(2)}, Profit: $${totalProfit.toFixed(2)}, Margin: ${(margin * 100).toFixed(1)}%`);
    }

    console.log(`${'='.repeat(80)}`);
    console.log(`[COMPLETE] Rows updated: ${rowUpdates.length} | Orders synced: ${results.orders_synced}`);
    console.log(`${'='.repeat(80)}\n`);

    return Response.json({
      success: true,
      ...results,
      rows_updated: rowUpdates.length,
      imports_updated: importsUpdated,
      deployment: DEPLOYMENT_V
    });

  } catch (error) {
    console.error('[recomputeSettlementCOGS] ERROR:', error);
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});