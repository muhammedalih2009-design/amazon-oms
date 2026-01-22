/**
 * BulkFulfillmentProcessor
 * Handles chunk-based, transactional-like fulfillment processing
 */

export class BulkFulfillmentProcessor {
  constructor(base44, tenantId) {
    this.base44 = base44;
    this.tenantId = tenantId;
    this.CHUNK_SIZE = 5; // Reduced from 10 to 5 to prevent rate limiting
    this.CHUNK_DELAY_MS = 800; // 800ms delay between chunks to stay below rate limits
    this.MAX_RETRIES = 2; // Retry up to 2 times on rate limit errors
    this.RETRY_DELAY_MS = 2000; // 2 second delay before retry
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
   * Process a single order with transactional-like logic with retry support
   * Returns: { success, orderId, error, details }
   * @param {boolean} forceMode - If true, bypass stock validation checks
   * @param {number} retryCount - Current retry attempt (for rate limit handling)
   */
  async processSingleOrder(order, orderLines, purchases, currentStock, skus, format, forceMode = false, retryCount = 0) {
    const orderId = order.id;
    const amazonOrderId = order.amazon_order_id;

    // Rollback tracking
    const rollbackActions = [];

    try {
      // Pre-check: Verify order is not already fulfilled
      const freshOrderRecords = await this.base44.entities.Order.filter({ id: orderId });
      if (freshOrderRecords.length === 0) {
        throw new Error('Order not found');
      }
      const freshOrder = freshOrderRecords[0];
      if (freshOrder.status === 'fulfilled') {
        throw new Error('Order already fulfilled - preventing duplicate processing');
      }

      // Step 1: Get fresh order lines for this order
      const lines = orderLines.filter(l => l.order_id === orderId && !l.is_returned);
      if (lines.length === 0) {
        throw new Error('No valid order lines found');
      }

      // Step 2: Validate stock availability (re-check current stock) - UNLESS force mode
      let totalCost = 0;
      const stockDeductions = new Map(); // sku_id -> quantity to deduct
      let forceFulfilledWarnings = [];

      for (const line of lines) {
        // Fresh stock check
        const stockRecords = await this.base44.entities.CurrentStock.filter({
          tenant_id: this.tenantId,
          sku_id: line.sku_id
        });

        const availableStock = stockRecords.length > 0 ? (stockRecords[0].quantity_available || 0) : 0;
        
        // Only enforce stock validation if NOT in force mode
        if (!forceMode && availableStock < line.quantity) {
          throw new Error(
            `Insufficient stock for ${line.sku_code}: Need ${line.quantity}, Have ${availableStock}`
          );
        }

        // Track if this was force-fulfilled with insufficient stock
        if (forceMode && availableStock < line.quantity) {
          forceFulfilledWarnings.push({
            sku_code: line.sku_code,
            required: line.quantity,
            available: availableStock,
            shortage: line.quantity - availableStock
          });
        }

        // Accumulate deductions (will allow negative stock in force mode)
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

      // Step 3: ATOMIC COMMIT - Update order status FIRST (fail-fast)
      // This ensures we never deduct stock without a fulfilled order
      await this.base44.entities.Order.update(orderId, {
        status: 'fulfilled',
        total_cost: totalCost,
        profit_loss: (order.net_revenue || 0) - totalCost,
        profit_margin_percent: order.net_revenue ? (((order.net_revenue - totalCost) / order.net_revenue) * 100) : null
      });

      // Verify status update succeeded
      const verifyRecords = await this.base44.entities.Order.filter({ id: orderId });
      const updatedOrder = verifyRecords[0];
      if (!updatedOrder || updatedOrder.status !== 'fulfilled') {
        throw new Error('Critical: Order status update failed - aborting fulfillment');
      }

      // Track rollback: revert status if subsequent operations fail
      rollbackActions.push(async () => {
        await this.base44.entities.Order.update(orderId, {
          status: 'pending',
          total_cost: 0,
          profit_loss: 0,
          profit_margin_percent: null
        });
      });

      // Step 4: Update purchase quantities (FIFO) - now that status is committed
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
        const purchaseUpdates = [];

        for (const purchase of skuPurchases) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, purchase.quantity_remaining || 0);
          
          await this.base44.entities.Purchase.update(purchase.id, {
            quantity_remaining: (purchase.quantity_remaining || 0) - take
          });

          // Track for rollback
          purchaseUpdates.push({ id: purchase.id, restore: take });
          
          remaining -= take;
        }

        // Track rollback for purchases
        if (purchaseUpdates.length > 0) {
          rollbackActions.push(async () => {
            for (const pu of purchaseUpdates) {
              const current = await this.base44.entities.Purchase.filter({ id: pu.id });
              if (current.length > 0) {
                await this.base44.entities.Purchase.update(pu.id, {
                  quantity_remaining: (current[0].quantity_remaining || 0) + pu.restore
                });
              }
            }
          });
        }
      }

      // Step 5: Update order lines with costs
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

      // Step 6: Deduct stock (critical operation) - allow negative in force mode
      const stockUpdates = [];
      for (const [skuId, qtyToDeduct] of stockDeductions) {
        const stockRecords = await this.base44.entities.CurrentStock.filter({
          tenant_id: this.tenantId,
          sku_id: skuId
        });

        if (stockRecords.length > 0) {
          const currentQty = stockRecords[0].quantity_available || 0;
          const newQty = currentQty - qtyToDeduct;

          // In force mode, allow negative stock. Otherwise, enforce validation.
          if (!forceMode && newQty < 0) {
            throw new Error(`Stock deduction failed: attempting to deduct ${qtyToDeduct} but only ${currentQty} available`);
          }

          await this.base44.entities.CurrentStock.update(stockRecords[0].id, {
            quantity_available: newQty
          });

          // Track for rollback
          stockUpdates.push({ id: stockRecords[0].id, skuId, restore: qtyToDeduct });
        }
      }

      // Track rollback for stock
      if (stockUpdates.length > 0) {
        rollbackActions.push(async () => {
          for (const su of stockUpdates) {
            const current = await this.base44.entities.CurrentStock.filter({ 
              tenant_id: this.tenantId,
              sku_id: su.skuId 
            });
            if (current.length > 0) {
              await this.base44.entities.CurrentStock.update(current[0].id, {
                quantity_available: (current[0].quantity_available || 0) + su.restore
              });
            }
          }
        });
      }

      // Step 7: Create stock movements (audit trail) with force note
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
          movement_date: format(new Date(), 'yyyy-MM-dd'),
          notes: forceMode ? 'Force fulfilled - bypassed stock validation' : undefined
        });
      }

      const BATCH_SIZE = 400;
      for (let i = 0; i < movements.length; i += BATCH_SIZE) {
        const batch = movements.slice(i, i + BATCH_SIZE);
        await this.base44.entities.StockMovement.bulkCreate(batch);
      }

      // Success message with force-fulfill indication
      let successMessage = `Successfully fulfilled with cost: $${totalCost.toFixed(2)}`;
      if (forceMode && forceFulfilledWarnings.length > 0) {
        successMessage += ` (FORCE FULFILLED - Negative stock created)`;
      }

      return {
        success: true,
        orderId: amazonOrderId,
        details: successMessage,
        forceMode: forceMode
      };

    } catch (error) {
      console.error(`Order fulfillment failed: ${amazonOrderId}`, error);

      // Check if this is a rate limit error and we haven't exceeded max retries
      const isRateLimitError = error.message?.toLowerCase().includes('rate limit') || 
                                error.message?.toLowerCase().includes('429') ||
                                error.message?.toLowerCase().includes('too many requests');
      
      if (isRateLimitError && retryCount < this.MAX_RETRIES) {
        console.warn(`⏳ Rate limit hit for order ${amazonOrderId}. Retrying in ${this.RETRY_DELAY_MS}ms (Attempt ${retryCount + 1}/${this.MAX_RETRIES})...`);
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_MS));
        
        // Retry the order processing
        return this.processSingleOrder(order, orderLines, purchases, currentStock, skus, format, forceMode, retryCount + 1);
      }

      // ROLLBACK: Attempt to restore all changes
      if (rollbackActions.length > 0) {
        console.warn(`Initiating rollback for order ${amazonOrderId}...`);
        try {
          // Execute rollback actions in reverse order
          for (let i = rollbackActions.length - 1; i >= 0; i--) {
            await rollbackActions[i]();
          }
          console.log(`✓ Rollback completed for order ${amazonOrderId}`);
        } catch (rollbackError) {
          console.error(`⚠ Rollback failed for order ${amazonOrderId}:`, rollbackError);
          return {
            success: false,
            orderId: amazonOrderId,
            error: `Transaction failed & rollback error: ${error.message}. MANUAL REVIEW REQUIRED for order ${amazonOrderId}`
          };
        }
      }

      return {
        success: false,
        orderId: amazonOrderId,
        error: `Transaction rolled back: ${error.message}${isRateLimitError ? ' (Max retries exceeded)' : ''}`
      };
    }
  }

  /**
   * Process orders in chunks with throttling to prevent rate limiting
   */
  async processOrdersInChunks(ordersToProcess, orderLines, purchases, currentStock, skus, format, onProgress, forceMode = false) {
    const results = [];
    const totalOrders = ordersToProcess.length;
    const totalChunks = Math.ceil(totalOrders / this.CHUNK_SIZE);

    console.log(`📦 Starting bulk fulfillment: ${totalOrders} orders in ${totalChunks} chunks of ${this.CHUNK_SIZE}`);

    for (let i = 0; i < totalOrders; i += this.CHUNK_SIZE) {
      const chunkNumber = Math.floor(i / this.CHUNK_SIZE) + 1;
      const chunk = ordersToProcess.slice(i, i + this.CHUNK_SIZE);
      
      console.log(`⚡ Processing chunk ${chunkNumber}/${totalChunks} (${chunk.length} orders)...`);
      
      // Process all orders in this chunk in parallel
      const chunkPromises = chunk.map(order =>
        this.processSingleOrder(order, orderLines, purchases, currentStock, skus, format, forceMode)
      );

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);

      // Update progress after each chunk
      const processed = Math.min(i + this.CHUNK_SIZE, totalOrders);
      onProgress(processed, results);

      // Throttle: Wait between chunks to prevent rate limiting (except for the last chunk)
      if (i + this.CHUNK_SIZE < totalOrders) {
        console.log(`⏳ Throttling: waiting ${this.CHUNK_DELAY_MS}ms before next chunk...`);
        await new Promise(resolve => setTimeout(resolve, this.CHUNK_DELAY_MS));
      }
    }

    console.log(`✅ Bulk fulfillment complete: ${results.filter(r => r.success).length}/${totalOrders} succeeded`);
    return results;
  }
}