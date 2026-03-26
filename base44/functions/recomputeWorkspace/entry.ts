import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - admin only' }, { status: 403 });
    }

    const { workspaceId } = await req.json();
    
    if (!workspaceId) {
      return Response.json({ error: 'workspaceId required' }, { status: 400 });
    }

    console.log(`🔄 RECOMPUTE STARTED for workspace: ${workspaceId}`);
    
    const results = {
      stores_updated: 0,
      orders_recomputed: 0,
      profitability_updated: 0,
      errors: []
    };

    try {
      // 1. RECOMPUTE STORE COUNTERS
      console.log('📊 Step 1/3: Recomputing store counters...');
      const [stores, orders] = await Promise.all([
        base44.asServiceRole.entities.Store.filter({ tenant_id: workspaceId }),
        base44.asServiceRole.entities.Order.filter({ tenant_id: workspaceId })
      ]);

      for (const store of stores) {
        const storeOrders = orders.filter(o => o.store_id === store.id);
        const totalOrders = storeOrders.length;
        const fulfilledCount = storeOrders.filter(o => o.status === 'fulfilled').length;
        const totalRevenue = storeOrders.reduce((sum, o) => sum + (o.net_revenue || 0), 0);
        const totalProfit = storeOrders.reduce((sum, o) => sum + (o.profit_loss || 0), 0);
        
        // Note: Store entity doesn't have counter fields, they're derived on-the-fly
        // This is correct - no update needed, just validation
        console.log(`✓ Store ${store.name}: ${totalOrders} orders, ${fulfilledCount} fulfilled`);
      }
      results.stores_updated = stores.length;

      // 2. RECOMPUTE ORDER COGS AND PROFITABILITY
      console.log('💰 Step 2/3: Recomputing order costs and profitability...');
      const [orderLines, purchases, skus] = await Promise.all([
        base44.asServiceRole.entities.OrderLine.filter({ tenant_id: workspaceId }),
        base44.asServiceRole.entities.Purchase.filter({ tenant_id: workspaceId }),
        base44.asServiceRole.entities.SKU.filter({ tenant_id: workspaceId })
      ]);

      // Group order lines by order
      const orderLinesByOrder = orderLines.reduce((acc, line) => {
        if (!acc[line.order_id]) acc[line.order_id] = [];
        acc[line.order_id].push(line);
        return acc;
      }, {});

      for (const order of orders) {
        const lines = orderLinesByOrder[order.id] || [];
        
        // Recompute total_cost from order lines
        let totalCost = 0;
        for (const line of lines) {
          if (line.unit_cost && line.quantity) {
            totalCost += line.unit_cost * line.quantity;
          } else {
            // Fallback to SKU cost
            const sku = skus.find(s => s.id === line.sku_id);
            if (sku?.cost_price && line.quantity) {
              totalCost += sku.cost_price * line.quantity;
            }
          }
        }

        // Recompute profit
        const netRevenue = order.net_revenue || 0;
        const profitLoss = netRevenue - totalCost;
        const marginPercent = netRevenue > 0 ? (profitLoss / netRevenue) * 100 : 0;

        await base44.asServiceRole.entities.Order.update(order.id, {
          total_cost: totalCost,
          profit_loss: profitLoss,
          profit_margin_percent: marginPercent
        });
        
        results.orders_recomputed++;
      }

      // 3. RECOMPUTE PROFITABILITY LINES
      console.log('📈 Step 3/3: Recomputing profitability lines...');
      const profLines = await base44.asServiceRole.entities.ProfitabilityLine.filter({ 
        tenant_id: workspaceId 
      });

      for (const profLine of profLines) {
        const order = orders.find(o => o.id === profLine.order_id);
        const orderLine = orderLines.find(ol => ol.id === profLine.order_line_id);
        
        if (order && orderLine) {
          const unitCost = orderLine.unit_cost || 0;
          const totalCost = unitCost * profLine.quantity;
          const revenue = profLine.revenue || 0;
          const profit = revenue - totalCost;
          const marginPercent = revenue > 0 ? (profit / revenue) * 100 : 0;

          await base44.asServiceRole.entities.ProfitabilityLine.update(profLine.id, {
            unit_cost: unitCost,
            total_cost: totalCost,
            profit,
            margin_percent: marginPercent
          });
          
          results.profitability_updated++;
        }
      }

      console.log('✅ RECOMPUTE COMPLETE:', results);
      
      return Response.json({
        success: true,
        results
      });
    } catch (error) {
      results.errors.push(error.message);
      throw error;
    }
  } catch (error) {
    console.error('Recompute workspace error:', error);
    return Response.json({ 
      error: error.message,
      details: error.stack 
    }, { status: 500 });
  }
});