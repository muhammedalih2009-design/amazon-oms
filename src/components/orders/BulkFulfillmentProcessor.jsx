/**
 * BulkFulfillmentProcessor
 * Handles chunk-based, transactional-like fulfillment processing
 */

export class BulkFulfillmentProcessor {
  constructor(base44, tenantId) {
    this.base44 = base44;
    this.tenantId = tenantId;
    this.CHUNK_SIZE = 10;
  }

  /**
   * Pre-fulfillment validation: Check all SKUs upfront
   */
  async validateBulkStock(ordersToProcess, orderLines, purchases, currentStock, skus) {
    const skuRequirements = new Map(); // sku_id -> { required, available }

    // Calculate total requirements per SKU across all orders
    for (const order of ordersToProcess) {
      const lines = orderLines.filter(l => l.order_id === order.id && !l.is_returned);
      for (const line of lines) {
        const current = skuRequirements.get(line.sku_id) || { required: 0, available: 0 };
        current.required += line.quantity;
        skuRequirements.set(line.sku_id, current);
      }
    }

    // Get actual available stock
    for (const [skuId, requirement] of skuRequirements) {
      const stock = currentStock.find(s => s.sku_id === skuId);
      const available = stock?.quantity_available || 0;
      requirement.available = available;
    }

    // Identify problematic SKUs
    const shortages = [];
    for (const [skuId, requirement] of skuRequirements) {
      if (requirement.required > requirement.available) {
        const sku = skus.find(s => s.id === skuId);
        shortages.push({
          sku_id: skuId,
          sku_code: sku?.sku_code,
          product_name: sku?.product_name,
          required: requirement.required,
          available: requirement.available,
          shortage: requirement.required - requirement.available
        });
      }
    }

    return { valid: shortages.length === 0, shortages };
  }

  /**
   * Process a single order with transactional-like logic
   * Returns: { success, orderId, error, details }
   */
  async processSingleOrder(order, orderLines, purchases, currentStock, skus, format) {
    const orderId = order.id;
    const amazonOrderId = order.amazon_order_id;

    try {
      // Step 1: Get fresh order lines for this order
      const lines = orderLines.filter(l => l.order_id === orderId && !l.is_returned);
      if (lines.length === 0) {
        throw new Error('No valid order lines found');
      }

      // Step 2: Validate stock availability (re-check current stock)
      let totalCost = 0;
      const stockDeductions = new Map(); // sku_id -> quantity to deduct

      for (const line of lines) {
        // Fresh stock check
        const stockRecords = await this.base44.entities.CurrentStock.filter({
          tenant_id: this.tenantId,
          sku_id: line.sku_id
        });

        const availableStock = stockRecords.length > 0 ? (stockRecords[0].quantity_available || 0) : 0;
        
        if (availableStock < line.quantity) {
          throw new Error(
            `Insufficient stock for ${line.sku_code}: Need ${line.quantity}, Have ${availableStock}`
          );
        }

        // Accumulate deductions
        const currentDeduction = stockDeductions.get(line.sku_id) || 0;
        stockDeductions.set(line.sku_id, currentDeduction + line.quantity);

        // Calculate cost using FIFO
        const skuPurchases = purchases
          .filter(p => {
            const purchaseSkuCode = p.sku_code?.trim().toLowerCase();
            const lineSkuCode = line.sku_code?.trim().toLowerCase();
            return (p.sku_id === line.sku_id || purchaseSkuCode === lineSkuCode) && 
                   (p.quantity_remaining || 0) > 0;
          })
          .sort((a, b) => new Date(a.purchase_date) - new Date(b.purchase_date));

        let remaining = line.quantity;
        let lineCost = 0;

        for (const purchase of skuPurchases) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, purchase.quantity_remaining || 0);
          lineCost += take * purchase.cost_per_unit;
          remaining -= take;
        }

        if (remaining > 0) {
          const sku = skus.find(s => s.id === line.sku_id);
          lineCost += remaining * (sku?.cost_price || 0);
        }

        totalCost += lineCost;
      }

      // Step 3: ATOMIC COMMIT - Execute all updates
      // If any step fails here, the entire order fails (simulating rollback)

      // 3a: Update purchase quantities (FIFO)
      for (const line of lines) {
        const skuPurchases = purchases
          .filter(p => {
            const purchaseSkuCode = p.sku_code?.trim().toLowerCase();
            const lineSkuCode = line.sku_code?.trim().toLowerCase();
            return (p.sku_id === line.sku_id || purchaseSkuCode === lineSkuCode) && 
                   (p.quantity_remaining || 0) > 0 &&
                   p.tenant_id === this.tenantId;
          })
          .sort((a, b) => new Date(a.purchase_date) - new Date(b.purchase_date));

        let remaining = line.quantity;

        for (const purchase of skuPurchases) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, purchase.quantity_remaining || 0);
          
          await this.base44.entities.Purchase.update(purchase.id, {
            quantity_remaining: (purchase.quantity_remaining || 0) - take
          });
          
          remaining -= take;
        }
      }

      // 3b: Update order lines with costs
      for (const line of lines) {
        const skuPurchases = purchases
          .filter(p => {
            const purchaseSkuCode = p.sku_code?.trim().toLowerCase();
            const lineSkuCode = line.sku_code?.trim().toLowerCase();
            return (p.sku_id === line.sku_id || purchaseSkuCode === lineSkuCode) && 
                   (p.quantity_remaining || 0) > 0;
          })
          .sort((a, b) => new Date(a.purchase_date) - new Date(b.purchase_date));

        let remaining = line.quantity;
        let lineCost = 0;

        for (const purchase of skuPurchases) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, purchase.quantity_remaining || 0);
          lineCost += take * purchase.cost_per_unit;
          remaining -= take;
        }

        if (remaining > 0) {
          const sku = skus.find(s => s.id === line.sku_id);
          lineCost += remaining * (sku?.cost_price || 0);
        }

        await this.base44.entities.OrderLine.update(line.id, {
          unit_cost: lineCost / line.quantity,
          line_total_cost: lineCost
        });
      }

      // 3c: Deduct stock
      for (const [skuId, qtyToDeduct] of stockDeductions) {
        const stockRecords = await this.base44.entities.CurrentStock.filter({
          tenant_id: this.tenantId,
          sku_id: skuId
        });

        if (stockRecords.length > 0) {
          const currentQty = stockRecords[0].quantity_available || 0;
          const newQty = currentQty - qtyToDeduct;

          if (newQty < 0) {
            throw new Error(`Stock validation failed: attempting to deduct ${qtyToDeduct} but only ${currentQty} available`);
          }

          await this.base44.entities.CurrentStock.update(stockRecords[0].id, {
            quantity_available: newQty
          });
        }
      }

      // 3d: Create stock movements
      const movements = [];
      for (const line of lines) {
        movements.push({
          tenant_id: this.tenantId,
          sku_id: line.sku_id,
          sku_code: line.sku_code,
          movement_type: 'order_fulfillment',
          quantity: -line.quantity,
          reference_type: 'order_line',
          reference_id: line.id,
          movement_date: format(new Date(), 'yyyy-MM-dd')
        });
      }

      const BATCH_SIZE = 400;
      for (let i = 0; i < movements.length; i += BATCH_SIZE) {
        const batch = movements.slice(i, i + BATCH_SIZE);
        await this.base44.entities.StockMovement.bulkCreate(batch);
      }

      // 3e: Update order status (LAST STEP - point of no return)
      await this.base44.entities.Order.update(orderId, {
        status: 'fulfilled',
        total_cost: totalCost,
        profit_loss: (order.net_revenue || 0) - totalCost,
        profit_margin_percent: order.net_revenue ? (((order.net_revenue - totalCost) / order.net_revenue) * 100) : null
      });

      // 3f: Verify the update
      const verifyRecords = await this.base44.entities.Order.filter({ id: orderId });
      const updatedOrder = verifyRecords[0];

      if (!updatedOrder || updatedOrder.status !== 'fulfilled') {
        throw new Error('Order status verification failed after update');
      }

      return {
        success: true,
        orderId: amazonOrderId,
        details: `Successfully fulfilled with cost: $${totalCost.toFixed(2)}`
      };

    } catch (error) {
      console.error(`Order fulfillment failed: ${amazonOrderId}`, error);
      return {
        success: false,
        orderId: amazonOrderId,
        error: error.message || 'Unknown error during fulfillment'
      };
    }
  }

  /**
   * Process orders in chunks
   */
  async processOrdersInChunks(ordersToProcess, orderLines, purchases, currentStock, skus, format, onProgress) {
    const results = [];
    const totalOrders = ordersToProcess.length;

    for (let i = 0; i < totalOrders; i += this.CHUNK_SIZE) {
      const chunk = ordersToProcess.slice(i, i + this.CHUNK_SIZE);
      const chunkPromises = chunk.map(order =>
        this.processSingleOrder(order, orderLines, purchases, currentStock, skus, format)
      );

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);

      // Update progress after each chunk
      const processed = Math.min(i + this.CHUNK_SIZE, totalOrders);
      onProgress(processed, results);

      // Small delay to prevent UI blocking
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return results;
  }
}