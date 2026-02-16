import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Canonical normalization for order ID matching
function normalizeOrderId(orderId) {
  if (!orderId) return '';
  
  return orderId
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '') // Remove zero-width and non-breaking chars
    .replace(/\s+/g, '') // Remove all whitespace
    .replace(/[\u2010-\u2015\u2212]/g, '-') // Normalize unicode dashes
    .replace(/-/g, ''); // Remove hyphens for comparison
}

// Try multiple matching strategies
function findMatchingOrder(settlementOrderId, orders) {
  const normalizedSettlement = normalizeOrderId(settlementOrderId);
  
  // Strategy 1: Direct normalized match
  let match = orders.find(o => normalizeOrderId(o.amazon_order_id) === normalizedSettlement);
  if (match) return { order: match, strategy: 'normalized_amazon_id', confidence: 'high' };
  
  // Strategy 2: Match with internal ID
  match = orders.find(o => normalizeOrderId(o.id) === normalizedSettlement);
  if (match) return { order: match, strategy: 'internal_id', confidence: 'high' };
  
  // Strategy 3: Partial match (contains) - only if both IDs are long enough
  match = orders.find(o => {
    const norm = normalizeOrderId(o.amazon_order_id);
    return norm.length >= 8 && normalizedSettlement.length >= 8 &&
           (norm.includes(normalizedSettlement) || normalizedSettlement.includes(norm));
  });
  if (match) return { order: match, strategy: 'partial_match', confidence: 'medium' };
  
  return null;
}

const NOT_FOUND_REASONS = {
  NO_MATCH_AFTER_NORMALIZATION: 'Order not found after normalization',
  ORDER_FOUND_COST_MISSING: 'Order matched but COGS missing',
  SKU_MISSING: 'Order matched, SKU not found',
  PARTIAL_SKU_MATCH: 'Order matched, partial SKU match',
  ORDER_DELETED: 'Order found but marked as deleted'
};

Deno.serve(async (req) => {
  const DEPLOYMENT_TIMESTAMP = '2026-02-16T17:30:00Z';
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id, import_id, row_id } = await req.json();

    if (!workspace_id) {
      return Response.json({ error: 'workspace_id required' }, { status: 400 });
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`REMATCH DIAGNOSTIC START - Deployment: ${DEPLOYMENT_TIMESTAMP}`);
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

    console.log(`[3] Membership verified`);

    // DIAGNOSTIC QUERIES - Test 3 different query patterns
    console.log(`\n${'='.repeat(80)}`);
    console.log('DIAGNOSTIC: Testing Order Query Patterns');
    console.log(`${'='.repeat(80)}`);
    
    // Query 1: Filter by tenant_id only
    const ordersByTenant = await base44.asServiceRole.entities.Order.filter({ tenant_id: workspace_id });
    console.log(`\n[Query 1] Filter by tenant_id only: ${ordersByTenant.length} orders found`);
    if (ordersByTenant.length > 0) {
      console.log('First 5 orders:');
      ordersByTenant.slice(0, 5).forEach((o, idx) => {
        console.log(`  ${idx + 1}. ID: ${o.id}`);
        console.log(`     amazon_order_id: ${o.amazon_order_id}`);
        console.log(`     tenant_id: ${o.tenant_id}`);
        console.log(`     is_deleted: ${o.is_deleted}`);
      });
    } else {
      console.log('  ⚠️  NO ORDERS FOUND WITH THIS TENANT_ID!');
    }
    
    // Query 2: Filter by amazon_order_id only (specific test ID)
    const testOrderId = '406-9098319-4354700';
    const ordersByAmazonId = await base44.asServiceRole.entities.Order.filter({ amazon_order_id: testOrderId });
    console.log(`\n[Query 2] Filter by amazon_order_id='${testOrderId}': ${ordersByAmazonId.length} orders found`);
    if (ordersByAmazonId.length > 0) {
      ordersByAmazonId.forEach((o, idx) => {
        console.log(`  ${idx + 1}. ID: ${o.id}`);
        console.log(`     amazon_order_id: ${o.amazon_order_id}`);
        console.log(`     tenant_id: ${o.tenant_id}`);
        console.log(`     is_deleted: ${o.is_deleted}`);
      });
    } else {
      console.log('  ⚠️  ORDER NOT FOUND BY AMAZON_ORDER_ID!');
    }
    
    // Query 3: Filter by tenant_id + amazon_order_id
    const ordersByBoth = await base44.asServiceRole.entities.Order.filter({ 
      tenant_id: workspace_id, 
      amazon_order_id: testOrderId 
    });
    console.log(`\n[Query 3] Filter by tenant_id + amazon_order_id: ${ordersByBoth.length} orders found`);
    if (ordersByBoth.length > 0) {
      ordersByBoth.forEach((o, idx) => {
        console.log(`  ${idx + 1}. ID: ${o.id}`);
        console.log(`     amazon_order_id: ${o.amazon_order_id}`);
        console.log(`     tenant_id: ${o.tenant_id}`);
        console.log(`     is_deleted: ${o.is_deleted}`);
      });
    } else {
      console.log('  ⚠️  NO ORDERS MATCH BOTH CRITERIA!');
    }

    // Check field name usage
    console.log(`\n${'='.repeat(80)}`);
    console.log('DIAGNOSTIC: Field Name Confirmation');
    console.log(`${'='.repeat(80)}`);
    if (ordersByTenant.length > 0) {
      const sampleOrder = ordersByTenant[0];
      console.log('Sample Order all fields:', Object.keys(sampleOrder));
      console.log(`Has 'amazon_order_id' field? ${('amazon_order_id' in sampleOrder)}`);
      console.log(`Has 'order_id' field? ${('order_id' in sampleOrder)}`);
    }

    // Load all workspace data - CRITICAL: Load ALL workspace orders, ignore date filters
    const [allOrders, skus, orderLines] = await Promise.all([
      base44.asServiceRole.entities.Order.filter({ tenant_id: workspace_id }),
      base44.asServiceRole.entities.SKU.filter({ tenant_id: workspace_id }),
      base44.asServiceRole.entities.OrderLine.filter({ tenant_id: workspace_id })
    ]);

    console.log(`\n${'='.repeat(80)}`);
    console.log('DATA LOADED FOR MATCHING');
    console.log(`${'='.repeat(80)}`);
    console.log(`Total Orders loaded: ${allOrders.length}`);
    console.log(`Total SKUs loaded: ${skus.length}`);
    console.log(`Total OrderLines loaded: ${orderLines.length}`);

    // Separate active from deleted orders
    const orders = allOrders.filter(o => !o.is_deleted);
    const deletedOrders = allOrders.filter(o => o.is_deleted);

    console.log(`Active Orders: ${orders.length}`);
    console.log(`Deleted Orders: ${deletedOrders.length}`);

    // Determine scope: single row or import or all
    let rowsToMatch = [];
    if (row_id) {
      const row = await base44.asServiceRole.entities.SettlementRow.get(row_id);
      if (!row || row.tenant_id !== workspace_id) {
        return Response.json({ error: 'Row not found' }, { status: 404 });
      }
      rowsToMatch = [row];
    } else if (import_id) {
      rowsToMatch = await base44.asServiceRole.entities.SettlementRow.filter({
        tenant_id: workspace_id,
        settlement_import_id: import_id,
        is_deleted: false
      });
    } else {
      rowsToMatch = await base44.asServiceRole.entities.SettlementRow.filter({
        tenant_id: workspace_id,
        is_deleted: false
      });
    }

    console.log(`\nSettlement Rows to Match: ${rowsToMatch.length}`);
    if (rowsToMatch.length > 0) {
      console.log('Sample SettlementRow fields:', Object.keys(rowsToMatch[0]));
      console.log(`Has 'order_id' field? ${('order_id' in rowsToMatch[0])}`);
    }

    // Diagnostic tracking for specific orders
    const diagnosticOrderIds = ['406-9098319-4354700', '405-9237140-1177144', '407-7729567-8966740'];
    const diagnosticResults = [];

    const results = {
      total_rows: rowsToMatch.length,
      newly_matched: 0,
      already_matched: 0,
      still_unmatched: 0,
      updated_cogs: 0,
      match_strategies: {}
    };

    const updates = [];

    for (const row of rowsToMatch) {
      const wasMatched = row.match_status === 'matched';
      
      // Find matching order in active orders first
      let matchResult = findMatchingOrder(row.order_id, orders);
      let notFoundReason = null;
      
      // CRITICAL FIX: Initialize with current values, only update if match found
      let updateData = {
        matched_order_id: row.matched_order_id || null,
        matched_sku_id: row.matched_sku_id || null,
        match_status: row.match_status || 'unmatched_order',
        match_strategy: row.match_strategy || null,
        not_found_reason: row.not_found_reason || null,
        raw_order_id: row.order_id,
        normalized_order_id: normalizeOrderId(row.order_id)
      };

      // Check if order exists but is deleted
      if (!matchResult && deletedOrders.length > 0) {
        const deletedMatch = findMatchingOrder(row.order_id, deletedOrders);
        if (deletedMatch) {
          notFoundReason = NOT_FOUND_REASONS.ORDER_DELETED;
        }
      }

      if (matchResult) {
        const { order, strategy, confidence } = matchResult;
        
        // CRITICAL FIX: Always persist matched_order_id when order is found
        updateData.matched_order_id = order.id;
        updateData.match_strategy = strategy;
        updateData.match_confidence = confidence;
        
        results.match_strategies[strategy] = (results.match_strategies[strategy] || 0) + 1;

        // Try to match SKU
        const matchedSku = skus.find(s => 
          s.sku_code === row.sku || 
          normalizeOrderId(s.sku_code) === normalizeOrderId(row.sku)
        );

        if (matchedSku) {
          updateData.matched_sku_id = matchedSku.id;
          updateData.match_status = 'matched';
          updateData.not_found_reason = null;
          
          // Check if order has COGS data
          if (!order.total_cost || order.total_cost === 0) {
            // Try to compute COGS from order lines
            const lines = orderLines.filter(l => l.order_id === order.id);
            const computedCogs = lines.reduce((sum, l) => sum + ((l.unit_cost || 0) * (l.quantity || 0)), 0);
            
            if (computedCogs === 0) {
              updateData.not_found_reason = NOT_FOUND_REASONS.ORDER_FOUND_COST_MISSING;
            }
          }
          
          if (!wasMatched) results.newly_matched++;
          else results.already_matched++;
        } else {
          // CRITICAL FIX: Order found but SKU missing - keep matched_order_id
          updateData.match_status = 'unmatched_sku';
          updateData.not_found_reason = NOT_FOUND_REASONS.SKU_MISSING;
          // matched_order_id already set above - DO NOT null it
          if (!wasMatched) results.newly_matched++;
          else results.already_matched++;
        }

        if (order.total_cost !== undefined && order.total_cost > 0) {
          results.updated_cogs++;
        }
      } else {
        // No order match - reset matched_order_id
        updateData.matched_order_id = null;
        updateData.match_status = 'unmatched_order';
        updateData.match_strategy = null;
        results.still_unmatched++;
        updateData.not_found_reason = notFoundReason || NOT_FOUND_REASONS.NO_MATCH_AFTER_NORMALIZATION;
      }

      // Collect diagnostic data for specific order IDs
      if (diagnosticOrderIds.includes(row.order_id)) {
        const diagOrder = matchResult ? matchResult.order : null;
        diagnosticResults.push({
          order_id: row.order_id,
          settlement_tenant: row.tenant_id,
          orders_tenant: diagOrder ? diagOrder.tenant_id : 'N/A',
          raw_match: diagOrder ? diagOrder.amazon_order_id : 'Not Found',
          normalized_match: matchResult ? matchResult.strategy : 'No Match',
          matched_order_id: updateData.matched_order_id,
          final_match_status: updateData.match_status,
          reason: updateData.not_found_reason || 'Success'
        });
      }

      // Only update if changed
      if (
        updateData.matched_order_id !== row.matched_order_id ||
        updateData.matched_sku_id !== row.matched_sku_id ||
        updateData.match_status !== row.match_status ||
        updateData.match_strategy !== row.match_strategy ||
        updateData.not_found_reason !== row.not_found_reason
      ) {
        updates.push({
          id: row.id,
          data: updateData
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
      
      if ((i + BATCH_SIZE) % 200 === 0) {
        console.log(`Progress: ${Math.min(i + BATCH_SIZE, updates.length)}/${updates.length} updates applied`);
      }
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log('DIAGNOSTIC RESULTS FOR SPECIFIC ORDERS');
    console.log(`${'='.repeat(80)}`);
    console.log('order_id | settlement_tenant | orders_tenant | raw_match | normalized_match | matched_order_id | final_match_status | reason');
    console.log('-'.repeat(80));
    diagnosticResults.forEach(d => {
      console.log(`${d.order_id} | ${d.settlement_tenant} | ${d.orders_tenant} | ${d.raw_match} | ${d.normalized_match} | ${d.matched_order_id} | ${d.final_match_status} | ${d.reason}`);
    });

    console.log(`\n${'='.repeat(80)}`);
    console.log('REMATCH COMPLETED');
    console.log(`${'='.repeat(80)}`);
    console.log('Results:', JSON.stringify(results, null, 2));
    console.log(`${'='.repeat(80)}\n`);

    return Response.json({
      success: true,
      ...results,
      rows_updated: updates.length,
      diagnostic: diagnosticResults,
      deployment: DEPLOYMENT_TIMESTAMP
    });

  } catch (error) {
    console.error('[rematchSettlementOrders] ERROR:', error);
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});