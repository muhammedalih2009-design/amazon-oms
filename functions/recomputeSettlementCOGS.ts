import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { normalizeOrderId } from './helpers/normalizeOrderId.js';

/**
 * Recompute COGS for settlement orders using canonical source-of-truth
 * Priority: Order.total_cost > Sum(OrderLine) > Fallback
 */

const COGS_SOURCE = {
  ORDER_TOTAL: 'ORDER_TOTAL',
  ORDER_LINES_SKU_COST: 'ORDER_LINES_SKU_COST',
  FALLBACK: 'FALLBACK',
  MISSING: 'MISSING'
};

const COGS_REASON = {
  SUCCESS: 'Success',
  ORDER_TOTAL_ZERO: 'Order.total_cost is zero',
  ORDER_LINES_MISSING: 'No order lines found',
  SKU_COST_MISSING: 'SKU cost_price missing',
  ORDER_FOUND_COST_MISSING: 'Order matched but COGS missing'
};

function computeCanonicalCOGS(matchedOrder, orderLines, skus) {
  // Priority A: Order.total_cost if > 0
  if (matchedOrder.total_cost && matchedOrder.total_cost > 0) {
    return {
      cogs: matchedOrder.total_cost,
      source: COGS_SOURCE.ORDER_TOTAL,
      reason: COGS_REASON.SUCCESS
    };
  }

  // Priority B: Sum(OrderLine.quantity * SKU.cost_price)
  const lines = orderLines.filter(l => l.order_id === matchedOrder.id);
  if (lines.length > 0) {
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
        reason: allSkusHaveCost ? COGS_REASON.SUCCESS : COGS_REASON.SKU_COST_MISSING
      };
    }

    return {
      cogs: 0,
      source: COGS_SOURCE.MISSING,
      reason: allSkusHaveCost ? COGS_REASON.ORDER_LINES_MISSING : COGS_REASON.SKU_COST_MISSING
    };
  }

  // Priority C/D: No order lines
  return {
    cogs: 0,
    source: COGS_SOURCE.MISSING,
    reason: COGS_REASON.ORDER_FOUND_COST_MISSING
  };
}

Deno.serve(async (req) => {
  const DEPLOYMENT_TIMESTAMP = '2026-02-16T21:00:00Z';
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id, import_id } = await req.json();

    if (!workspace_id) {
      return Response.json({ error: 'workspace_id required' }, { status: 400 });
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`RECOMPUTE COGS START - Deployment: ${DEPLOYMENT_TIMESTAMP}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`[1] Request workspace_id: ${workspace_id}`);
    console.log(`[2] User: ${user.email}`);

    // Verify membership
    const membership = await base44.asServiceRole.entities.Membership.filter({
      tenant_id: workspace_id,
      user_id: user.id
    });

    if (membership.length === 0) {
      return Response.json({ error: 'No access to workspace' }, { status: 403 });
    }

    // Load workspace data
    const [orders, orderLines, skus] = await Promise.all([
      base44.asServiceRole.entities.Order.filter({ tenant_id: workspace_id, is_deleted: false }),
      base44.asServiceRole.entities.OrderLine.filter({ tenant_id: workspace_id }),
      base44.asServiceRole.entities.SKU.filter({ tenant_id: workspace_id })
    ]);

    console.log(`Loaded: ${orders.length} orders, ${orderLines.length} lines, ${skus.length} SKUs`);

    // Get settlement rows to recompute
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

    console.log(`Settlement rows to recompute: ${rowsToRecompute.length}`);

    const results = {
      total_rows: rowsToRecompute.length,
      rows_with_cogs: 0,
      rows_missing_cogs: 0,
      cogs_by_source: {
        ORDER_TOTAL: 0,
        ORDER_LINES_SKU_COST: 0,
        MISSING: 0
      },
      diagnostic_orders: []
    };

    const updates = [];
    const diagnosticOrderIds = ['406-9098319-4354700', '405-9237140-1177144', '407-7729567-8966740'];

    for (const row of rowsToRecompute) {
      // Only recompute for matched orders
      if (!row.matched_order_id) continue;

      const matchedOrder = orders.find(o => o.id === row.matched_order_id);
      if (!matchedOrder) continue;

      const cogsResult = computeCanonicalCOGS(matchedOrder, orderLines, skus);

      // Update row with computed COGS metadata
      updates.push({
        id: row.id,
        data: {
          not_found_reason: cogsResult.reason !== COGS_REASON.SUCCESS ? cogsResult.reason : null
        }
      });

      if (cogsResult.cogs > 0) {
        results.rows_with_cogs++;
      } else {
        results.rows_missing_cogs++;
      }

      results.cogs_by_source[cogsResult.source]++;

      // Track diagnostic orders
      if (diagnosticOrderIds.includes(row.order_id)) {
        results.diagnostic_orders.push({
          order_id: row.order_id,
          found: true,
          orders_cost: matchedOrder.total_cost || 0,
          settlement_cogs: cogsResult.cogs,
          cogs_source: cogsResult.source,
          reason: cogsResult.reason,
          order_lines_count: orderLines.filter(l => l.order_id === matchedOrder.id).length
        });
      }
    }

    // Apply updates in batches
    const BATCH_SIZE = 50;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(item => 
          base44.asServiceRole.entities.SettlementRow.update(item.id, item.data)
        )
      );
    }

    // Recompute import totals if import_id specified
    if (import_id) {
      const importRows = await base44.asServiceRole.entities.SettlementRow.filter({
        settlement_import_id: import_id,
        is_deleted: false
      });

      const totalRevenue = importRows.reduce((sum, r) => sum + r.total, 0);
      let totalCogs = 0;

      for (const row of importRows) {
        if (row.matched_order_id) {
          const matchedOrder = orders.find(o => o.id === row.matched_order_id);
          if (matchedOrder) {
            const cogsResult = computeCanonicalCOGS(matchedOrder, orderLines, skus);
            // Proportional COGS for this row
            const orderRevenue = Math.abs(matchedOrder.net_revenue || 1);
            totalCogs += cogsResult.cogs * (Math.abs(row.signed_qty) / orderRevenue);
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

      console.log(`Updated import ${import_id} totals: COGS=${totalCogs}`);
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log('RECOMPUTE COGS COMPLETED');
    console.log(`${'='.repeat(80)}`);
    console.log('Results:', JSON.stringify(results, null, 2));
    console.log(`${'='.repeat(80)}\n`);

    return Response.json({
      success: true,
      ...results,
      rows_updated: updates.length,
      deployment: DEPLOYMENT_TIMESTAMP
    });

  } catch (error) {
    console.error('[recomputeSettlementCOGS] ERROR:', error);
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});