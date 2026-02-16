/**
 * Canonical COGS computation function
 * Used in both recompute and frontend display logic
 * 
 * @param {Object} order - The Order entity
 * @param {Array} orderLines - All OrderLine entities for this workspace
 * @param {Array} skus - All SKU entities for this workspace
 * @returns {Object} { cogs, cogsSource, reason, itemsCount, itemsCogsSum }
 */
export function computeOrderCogs(order, orderLines, skus) {
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