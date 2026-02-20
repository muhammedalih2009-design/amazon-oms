import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { computeOrderCogs } from './helpers/computeOrderCogs.js';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - admin only' }, { status: 403 });
    }

    const { tenantId, orderIds } = await req.json();
    
    if (!tenantId) {
      return Response.json({ error: 'tenantId required' }, { status: 400 });
    }

    console.log(`🔄 RECOMPUTE SETTLEMENT COGS: tenantId=${tenantId}, orderIds=${orderIds?.length || 'all'}`);

    // Fetch data
    const [orders, orderLines, skus] = await Promise.all([
      base44.asServiceRole.entities.Order.filter({ tenant_id: tenantId }),
      base44.asServiceRole.entities.OrderLine.filter({ tenant_id: tenantId }),
      base44.asServiceRole.entities.SKU.filter({ tenant_id: tenantId })
    ]);

    // Filter orders if specific IDs provided
    const targetOrders = orderIds && orderIds.length > 0
      ? orders.filter(o => orderIds.includes(o.id))
      : orders;

    // Filter for orders with settlement data (eligible for COGS computation)
    const eligibleOrders = targetOrders.filter(o => o.settlement_date && o.net_revenue);

    console.log(`📊 Found ${eligibleOrders.length} eligible orders with settlement data`);

    let rowsUpdated = 0;
    let rowsSkipped = 0;
    const cogsBreakdown = {
      order_field: 0,
      items_sum: 0,
      missing: 0
    };

    // TASK 2 FIX: Persist COGS values during recompute
    for (const order of eligibleOrders) {
      const cogsResult = computeOrderCogs(order, orderLines, skus);
      
      // Track COGS source
      if (cogsResult.cogsSource.startsWith('order_field')) {
        cogsBreakdown.order_field++;
      } else if (cogsResult.cogsSource === 'items_sum') {
        cogsBreakdown.items_sum++;
      } else {
        cogsBreakdown.missing++;
      }

      // Only update if COGS was found
      if (cogsResult.cogs !== null && cogsResult.cogs > 0) {
        const netRevenue = order.net_revenue || 0;
        const profitLoss = netRevenue - cogsResult.cogs;
        const marginPercent = netRevenue > 0 ? (profitLoss / netRevenue) * 100 : 0;

        // TASK 2: Persist COGS value, source, and reason
        await base44.asServiceRole.entities.Order.update(order.id, {
          total_cost: cogsResult.cogs,
          cogs_value: cogsResult.cogs, // Explicit COGS field
          cogs_source: cogsResult.cogsSource, // How it was computed
          cogs_reason: cogsResult.reason, // Success/failure reason
          profit_loss: profitLoss,
          profit_margin_percent: marginPercent
        });

        rowsUpdated++;
      } else {
        // Persist the "not found" state
        await base44.asServiceRole.entities.Order.update(order.id, {
          cogs_value: null,
          cogs_source: cogsResult.cogsSource,
          cogs_reason: cogsResult.reason, // Why COGS is missing
          not_found_reason: cogsResult.reason // Legacy field for compatibility
        });
        
        rowsSkipped++;
      }
    }

    // TASK 2: Diagnostic - if eligible rows > 0 but rows_updated = 0, return error code
    if (eligibleOrders.length > 0 && rowsUpdated === 0) {
      console.error(`❌ DIAGNOSTIC ERROR: ${eligibleOrders.length} eligible orders but 0 updated`);
      return Response.json({
        success: false,
        error_code: 'ZERO_UPDATES_WITH_ELIGIBLE_DATA',
        diagnostic: {
          eligible_orders: eligibleOrders.length,
          rows_updated: 0,
          rows_skipped: rowsSkipped,
          cogs_breakdown: cogsBreakdown,
          sample_orders: eligibleOrders.slice(0, 3).map(o => ({
            id: o.id,
            amazon_order_id: o.amazon_order_id,
            settlement_date: o.settlement_date,
            net_revenue: o.net_revenue,
            has_order_lines: orderLines.filter(ol => ol.order_id === o.id).length
          }))
        }
      }, { status: 422 });
    }

    console.log(`✅ RECOMPUTE COMPLETE: updated=${rowsUpdated}, skipped=${rowsSkipped}`);

    return Response.json({
      success: true,
      stats: {
        eligible_orders: eligibleOrders.length,
        rows_updated: rowsUpdated,
        rows_skipped: rowsSkipped,
        cogs_breakdown: cogsBreakdown
      }
    });

  } catch (error) {
    console.error('Recompute settlement COGS error:', error);
    return Response.json({ 
      error: error.message,
      details: error.stack 
    }, { status: 500 });
  }
});