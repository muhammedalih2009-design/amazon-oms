import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Canonical COGS computation (mirrors the helper function)
 * Returns: { cogs, cogsSource, reason, itemsCount, itemsCogsSum, rawFields }
 */
function computeCanonicalCOGS(order, orderLines, skus) {
  if (!order) {
    return { cogs: null, cogsSource: 'missing', reason: 'Order not found', itemsCount: 0, itemsCogsSum: 0 };
  }

  // PRIORITY 1: Order-level cost fields (in order of preference)
  const costFields = ['cost', 'total_cost', 'cogs', 'order_cost'];
  for (const field of costFields) {
    if (order[field] && order[field] > 0) {
      return {
        cogs: order[field],
        cogsSource: `order_field:${field}`,
        reason: 'Success',
        itemsCount: 0,
        itemsCogsSum: 0,
        rawFields: { cost: order.cost, total_cost: order.total_cost, cogs: order.cogs, order_cost: order.order_cost }
      };
    }
  }

  // PRIORITY 2: Compute from OrderLine items
  const itemsForOrder = orderLines.filter(line => line.order_id === order.id);
  
  if (itemsForOrder.length > 0) {
    let itemsCogsSum = 0;
    let allItemsHaveCost = true;

    for (const item of itemsForOrder) {
      // Check for cost fields on the item (multiple naming conventions)
      const itemCostField = item.unit_cost || item.cost || item.cogs || item.avg_cost || item.last_cost;
      const itemQty = item.quantity || item.qty || 0;

      if (itemCostField && itemCostField > 0) {
        itemsCogsSum += itemCostField * itemQty;
      } else {
        allItemsHaveCost = false;
      }
    }

    if (itemsCogsSum > 0) {
      return {
        cogs: itemsCogsSum,
        cogsSource: 'items_sum',
        reason: 'Computed from OrderLine items',
        itemsCount: itemsForOrder.length,
        itemsCogsSum: itemsCogsSum,
        rawFields: { cost: order.cost, total_cost: order.total_cost, cogs: order.cogs, order_cost: order.order_cost }
      };
    }

    // Items exist but no cost data on any item
    return {
      cogs: null,
      cogsSource: 'missing',
      reason: allItemsHaveCost ? 'Items found but all costs are zero' : 'Items found but missing cost fields',
      itemsCount: itemsForOrder.length,
      itemsCogsSum: 0,
      rawFields: { cost: order.cost, total_cost: order.total_cost, cogs: order.cogs, order_cost: order.order_cost }
    };
  }

  // PRIORITY 3: No order lines and no order-level cost
  return {
    cogs: null,
    cogsSource: 'missing',
    reason: 'Order found but no cost data (no order lines and no order-level cost)',
    itemsCount: 0,
    itemsCogsSum: 0,
    rawFields: { cost: order.cost, total_cost: order.total_cost, cogs: order.cogs, order_cost: order.order_cost }
  };
}

Deno.serve(async (req) => {
  const DEPLOYMENT_V = 'v4.1.0-' + Date.now();
  const START_TIME = Date.now();
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const reqBody = await req.json();
    const { import_id } = reqBody;

    console.log(`[DEPLOYMENT] ${DEPLOYMENT_V}`);
    console.log(`[REQUEST] Payload:`, { import_id, user_id: user.id });

    // Derive workspace_id from user's membership
    const memberships = await base44.asServiceRole.entities.Membership.filter({
      user_id: user.id
    });

    if (memberships.length === 0) {
      return Response.json({ error: 'No workspace access found for user' }, { status: 403 });
    }

    const userMembership = memberships[0];
    const workspace_id = userMembership.tenant_id;

    console.log(`[WORKSPACE] Derived workspace_id: ${workspace_id}`);

    // Fetch order lines and SKUs FRESH from DB (bypass cache)
    const [orderLines, skus] = await Promise.all([
      base44.asServiceRole.entities.OrderLine.filter({ tenant_id: workspace_id }),
      base44.asServiceRole.entities.SKU.filter({ tenant_id: workspace_id })
    ]);
    
    // IMPORTANT: Do not reuse these arrays - refetch for each workspace context

    console.log(`[DATA] OrderLines: ${orderLines.length} | SKUs: ${skus.length}`);

    // Check for any active orders
    const anyActiveOrders = await base44.asServiceRole.entities.Order.filter({ 
      tenant_id: workspace_id, 
      is_deleted: false,
      limit: 1
    });
    
    if (anyActiveOrders.length === 0) {
      console.log(`[WARNING] No active orders found for workspace_id: ${workspace_id}. Cannot recompute COGS.`);
      return Response.json({
        success: false,
        error_code: 'NO_ACTIVE_ORDERS',
        message: 'No active orders found in workspace. Ensure orders are imported and not deleted.',
        total_rows_scanned: 0,
        eligible_rows: 0
      }, { status: 400 });
    }

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
      rows_skipped_deleted_order: 0,
      cogs_by_source: {
        ORDER_FIELD: 0,
        ITEMS_SUM: 0,
        MISSING: 0
      },
      orders_synced: 0,
      debug_orders: [],
      proof_table: []
    };

    const rowUpdates = [];
    const orderUpdates = new Map();
    const skippedReasons = {};
    let processedCount = 0;
    const processedOrders = new Map();

    for (const row of matchedRows) {
      // Use direct lookup to check for deleted orders
      let matchedOrder;
      try {
        matchedOrder = await base44.asServiceRole.entities.Order.get(row.matched_order_id);
      } catch (err) {
        console.log(`[COGS LOOKUP] Failed to get Order ${row.matched_order_id}: ${err.message}`);
        // matchedOrder remains undefined, handled by the next if block
      }

      if (!matchedOrder || matchedOrder.is_deleted) {
        if (matchedOrder?.is_deleted) {
          skippedReasons['ORDER_DELETED'] = (skippedReasons['ORDER_DELETED'] || 0) + 1;
          results.rows_skipped_deleted_order++;
          console.warn(`[SKIP] Row ${row.order_id}: Matched order ID ${row.matched_order_id} found but is deleted.`);
        } else {
          skippedReasons['ORDER_NOT_FOUND'] = (skippedReasons['ORDER_NOT_FOUND'] || 0) + 1;
          console.warn(`[SKIP] Row ${row.order_id}: Matched order ID not found or accessible: ${row.matched_order_id}`);
        }
        continue;
      }

      const orderTotalCostBefore = matchedOrder.total_cost || 0;
      const cogsResult = computeCanonicalCOGS(matchedOrder, orderLines, skus);

      processedCount++;

      // Store canonical COGS result per matched order (only once)
      if (!processedOrders.has(matchedOrder.id)) {
        processedOrders.set(matchedOrder.id, cogsResult);
      }

      // DEBUG: Track specific orders
      results.debug_orders.push({
        order_id: row.order_id,
        matched_order_id: matchedOrder.id,
        order_total_cost_before: orderTotalCostBefore,
        order_total_cost_after: cogsResult.cogs || orderTotalCostBefore,
        row_cogs_before: 0,
        row_cogs_after: cogsResult.cogs,
        cogs_source: cogsResult.cogsSource,
        cogs_reason: cogsResult.reason,
        items_count: cogsResult.itemsCount,
        items_cogs_sum: cogsResult.itemsCogsSum
      });
      console.log(`[COGS COMPUTE] ${row.order_id}:`, results.debug_orders[results.debug_orders.length - 1]);

      // Update settlement row with cost source and reason
      const updateData = {
        not_found_reason: cogsResult.cogs ? null : cogsResult.reason
      };
      
      // Log explicit cost missing status
      if (!cogsResult.cogs) {
        console.log(`[COGS MISSING] order_id=${row.order_id}, matched=${matchedOrder.id}, reason=${cogsResult.reason}, source=${cogsResult.cogsSource}`);
      }

      rowUpdates.push({
        id: row.id,
        data: updateData
      });

      // Sync Order.total_cost if computed from items and currently empty
      if (cogsResult.cogsSource === 'items_sum' && orderTotalCostBefore === 0 && cogsResult.cogs > 0) {
        if (!orderUpdates.has(matchedOrder.id)) {
          const newTotal = cogsResult.cogs;
          orderUpdates.set(matchedOrder.id, {
            id: matchedOrder.id,
            total_cost: newTotal,
            profit_loss: (matchedOrder.net_revenue || 0) - newTotal,
            profit_margin_percent: matchedOrder.net_revenue 
              ? ((matchedOrder.net_revenue - newTotal) / matchedOrder.net_revenue) * 100 
              : 0
          });
          console.log(`[COGS SYNC] Synced to Order ${matchedOrder.id}, source=${cogsResult.cogsSource}, cogs=${newTotal}`);
        }
      }

      if (cogsResult.cogs && cogsResult.cogs > 0) {
        results.rows_with_cogs++;
      } else {
        results.rows_missing_cogs++;
      }

      // Track COGS source
      const sourceKey = cogsResult.cogsSource.split(':')[0].toUpperCase();
      const trackingKey = sourceKey === 'ORDER_FIELD' ? 'ORDER_FIELD' : (sourceKey === 'ITEMS' ? 'ITEMS_SUM' : 'MISSING');
      results.cogs_by_source[trackingKey] = (results.cogs_by_source[trackingKey] || 0) + 1;
    }

    // Build proof table for processed orders
    console.log(`[COGS RULE] Building proof table for ${processedOrders.size} unique matched orders...`);
    for (const [orderId, cogsResult] of processedOrders.entries()) {
      let orderData;
      try {
        orderData = await base44.asServiceRole.entities.Order.get(orderId);
      } catch (err) {
        console.log(`[PROOF TABLE] Failed to get Order ${orderId} for proof table: ${err.message}`);
        continue;
      }

      if (orderData) {
        results.proof_table.push({
          order_id: orderData.amazon_order_id || 'N/A',
          matched_order_id: orderId,
          order_cost_source: cogsResult.cogsSource,
          cogs_before: 0,
          cogs_after: cogsResult.cogs,
          reason: cogsResult.reason,
          net_revenue: orderData.net_revenue || 0,
          profit: (orderData.net_revenue || 0) - (cogsResult.cogs || 0)
        });
      }
    }
    console.log(`[COGS RULE] Proof table rows: ${results.proof_table.length}`);

    console.log(`[PROCESSING] Processed: ${processedCount} | Updated: ${rowUpdates.length} | Skipped:`, skippedReasons);

    console.log(`[UPDATES] Settlement rows to update: ${rowUpdates.length} | Orders to sync: ${orderUpdates.size}`);

    // ERROR CHECK: If eligible rows but 0 updates, this is a problem
    if (matchedRows.length > 0 && rowUpdates.length === 0) {
      console.error(`[FATAL] Eligible rows: ${matchedRows.length} but rowUpdates: ${rowUpdates.length}`);
      return Response.json({
        success: false,
        error_code: 'PROCESSING_FAILURE',
        total_rows_scanned: rowsToRecompute.length,
        eligible_rows: matchedRows.length,
        rows_processed: processedCount,
        rows_updated: 0,
        message: `Fatal: Found ${matchedRows.length} eligible rows but processed ${processedCount}, updated 0`
      }, { status: 500 });
    }

    // Apply settlement row updates in batches
    const BATCH_SIZE = 50;
    let settledRowsUpdated = 0;
    for (let i = 0; i < rowUpdates.length; i += BATCH_SIZE) {
      const batch = rowUpdates.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(item => 
          base44.asServiceRole.entities.SettlementRow.update(item.id, item.data)
        )
      );
      settledRowsUpdated += batch.length;
    }
    console.log(`[PERSIST] SettlementRow updates applied: ${settledRowsUpdated}`);

    // Apply order updates
    for (const [orderId, updateData] of orderUpdates) {
      await base44.asServiceRole.entities.Order.update(orderId, updateData);
      results.orders_synced++;
    }
    console.log(`[PERSIST] Order updates applied: ${results.orders_synced}`);

    // Recompute import totals
    let importsUpdated = 0;
    let cachedTotals = null;
    if (import_id) {
      const importRows = await base44.asServiceRole.entities.SettlementRow.filter({
        settlement_import_id: import_id,
        is_deleted: false
      });

      const totalRevenue = importRows.reduce((sum, r) => sum + (r.total || 0), 0);
      let totalCogs = 0;

      for (const row of importRows) {
        if (row.matched_order_id) {
          let matchedOrder;
          try {
            matchedOrder = await base44.asServiceRole.entities.Order.get(row.matched_order_id);
          } catch (err) {
            console.log(`[COGS LOOKUP] Failed to get Order ${row.matched_order_id} for totals recompute: ${err.message}`);
            continue;
          }
          
          if (!matchedOrder || matchedOrder.is_deleted) {
            console.warn(`[COGS LOOKUP] Skipped deleted or unfound Order ${row.matched_order_id} for totals recompute.`);
            continue;
          }

          const cogsResult = computeCanonicalCOGS(matchedOrder, orderLines, skus);
          // Proportional COGS allocation based on quantity
          const orderTotalQty = Math.abs(matchedOrder.net_revenue || 1);
          totalCogs += cogsResult.cogs * (Math.abs(row.signed_qty) / orderTotalQty);
        }
      }

      const totalProfit = totalRevenue - totalCogs;
      const margin = totalRevenue !== 0 ? (totalProfit / totalRevenue) : 0;

      cachedTotals = {
        total_revenue: totalRevenue,
        total_cogs: totalCogs,
        total_profit: totalProfit,
        margin: margin,
        orders_count: new Set(importRows.map(r => r.order_id)).size,
        skus_count: new Set(importRows.map(r => r.sku)).size
      };

      await base44.asServiceRole.entities.SettlementImport.update(import_id, {
        totals_cached_json: cachedTotals
      });

      importsUpdated = 1;
      console.log(`[PERSIST] SettlementImport.totals_cached_json:`, cachedTotals);
    }

    const elapsed = Date.now() - START_TIME;
    console.log(`[COMPLETE] Total rows scanned: ${rowsToRecompute.length} | Eligible: ${matchedRows.length} | Updated: ${rowUpdates.length} | Orders synced: ${results.orders_synced} | Duration: ${elapsed}ms`);
    
    // Log proof table summary
    const proofWithCOGS = results.proof_table.filter(p => p.cogs_after > 0).length;
    const proofMissingCOGS = results.proof_table.filter(p => !p.cogs_after).length;
    console.log(`[PROOF TABLE] Total orders: ${results.proof_table.length} | With COGS: ${proofWithCOGS} | Missing COGS: ${proofMissingCOGS}`);
    
    if (proofMissingCOGS > 0) {
      console.warn(`[PROOF TABLE WARNING] ${proofMissingCOGS} matched orders have no COGS:`);
      results.proof_table.filter(p => !p.cogs_after).slice(0, 5).forEach(p => {
        console.warn(`  - ${p.order_id} (${p.matched_order_id}): reason=${p.reason}, source=${p.order_cost_source}`);
      });
    }

    return Response.json({
      success: true,
      ...results,
      rows_updated: rowUpdates.length,
      imports_updated: importsUpdated,
      cached_totals: cachedTotals,
      deployment: DEPLOYMENT_V,
      duration_ms: elapsed,
      proof_table_summary: {
        total_orders: results.proof_table.length,
        with_cogs: proofWithCOGS,
        missing_cogs: proofMissingCOGS
      }
    });

  } catch (error) {
    console.error('[recomputeSettlementCOGS] ERROR:', error);
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});