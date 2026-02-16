import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Canonical normalization for order ID matching
function normalizeOrderId(orderId) {
  if (!orderId) return '';
  
  return orderId
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width chars
    .replace(/\s+/g, '') // Remove all whitespace
    .replace(/-/g, ''); // Remove hyphens for comparison
}

// Try multiple matching strategies
function findMatchingOrder(settlementOrderId, orders) {
  const normalizedSettlement = normalizeOrderId(settlementOrderId);
  
  // Strategy 1: Direct normalized match
  let match = orders.find(o => normalizeOrderId(o.amazon_order_id) === normalizedSettlement);
  if (match) return { order: match, strategy: 'normalized_amazon_id' };
  
  // Strategy 2: Match with internal ID
  match = orders.find(o => normalizeOrderId(o.id) === normalizedSettlement);
  if (match) return { order: match, strategy: 'internal_id' };
  
  // Strategy 3: Partial match (contains)
  match = orders.find(o => {
    const norm = normalizeOrderId(o.amazon_order_id);
    return norm.includes(normalizedSettlement) || normalizedSettlement.includes(norm);
  });
  if (match) return { order: match, strategy: 'partial_match' };
  
  return null;
}

Deno.serve(async (req) => {
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

    // Verify membership
    const membership = await base44.asServiceRole.entities.Membership.filter({
      tenant_id: workspace_id,
      user_id: user.id
    });

    if (membership.length === 0) {
      return Response.json({ error: 'No access to workspace' }, { status: 403 });
    }

    console.log('[rematchSettlementOrders] Starting rematch for workspace:', workspace_id);

    // Load orders and SKUs
    const [orders, skus] = await Promise.all([
      base44.asServiceRole.entities.Order.filter({ 
        tenant_id: workspace_id,
        is_deleted: false
      }),
      base44.asServiceRole.entities.SKU.filter({ tenant_id: workspace_id })
    ]);

    console.log(`[rematchSettlementOrders] Found ${orders.length} orders, ${skus.length} SKUs`);

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

    console.log(`[rematchSettlementOrders] Rematching ${rowsToMatch.length} rows`);

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
      
      // Find matching order
      const matchResult = findMatchingOrder(row.order_id, orders);
      
      let updateData = {
        matched_order_id: null,
        matched_sku_id: null,
        match_status: 'unmatched_order'
      };

      if (matchResult) {
        const { order, strategy } = matchResult;
        updateData.matched_order_id = order.id;
        
        results.match_strategies[strategy] = (results.match_strategies[strategy] || 0) + 1;

        // Try to match SKU
        const matchedSku = skus.find(s => 
          s.sku_code === row.sku || 
          normalizeOrderId(s.sku_code) === normalizeOrderId(row.sku)
        );

        if (matchedSku) {
          updateData.matched_sku_id = matchedSku.id;
          updateData.match_status = 'matched';
          
          if (!wasMatched) results.newly_matched++;
          else results.already_matched++;
        } else {
          updateData.match_status = 'unmatched_sku';
          if (!wasMatched) results.newly_matched++;
          else results.already_matched++;
        }

        if (order.total_cost !== undefined && order.total_cost > 0) {
          results.updated_cogs++;
        }
      } else {
        results.still_unmatched++;
      }

      // Only update if changed
      if (
        updateData.matched_order_id !== row.matched_order_id ||
        updateData.matched_sku_id !== row.matched_sku_id ||
        updateData.match_status !== row.match_status
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
        console.log(`[rematchSettlementOrders] Progress: ${Math.min(i + BATCH_SIZE, updates.length)}/${updates.length}`);
      }
    }

    console.log('[rematchSettlementOrders] Completed:', results);

    return Response.json({
      success: true,
      ...results,
      rows_updated: updates.length
    });

  } catch (error) {
    console.error('[rematchSettlementOrders] Error:', error);
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});