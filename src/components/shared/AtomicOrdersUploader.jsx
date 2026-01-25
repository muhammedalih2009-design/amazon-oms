/**
 * AtomicOrdersUploader
 * Implements atomic order import with grouped transactions, retry logic, and rollback
 * Groups rows by (store_id, amazon_order_id) to ensure all-or-nothing per order
 */

import { base44 } from '@/api/base44Client';

export class AtomicOrdersUploader {
  constructor(tenantId) {
    this.tenantId = tenantId;
    this.MAX_RETRIES = 3;
    this.RETRY_DELAYS = [500, 1000, 2000]; // exponential backoff
    this.BATCH_SIZE = 5; // Process 5 order groups concurrently
  }

  /**
   * Group CSV rows by order (amazon_order_id + store_id)
   * Returns Map<orderKey, {orderData, lines[]}>
   */
  groupOrdersByEntity(rows, skuMap, stores) {
    const orderGroups = new Map();
    
    rows.forEach((row, index) => {
      const orderKey = `${row._resolvedStoreId}_${row.amazon_order_id.toLowerCase().trim()}`;
      
      if (!orderGroups.has(orderKey)) {
        const store = stores.find(s => s.id === row._resolvedStoreId);
        orderGroups.set(orderKey, {
          orderData: {
            amazon_order_id: row.amazon_order_id.trim(),
            order_date: row.order_date,
            store_id: row._resolvedStoreId,
            store_name: store?.name,
            store_color: store?.color,
            _firstRowNumber: index + 1
          },
          lines: [],
          originalRows: []
        });
      }
      
      const group = orderGroups.get(orderKey);
      const sku = skuMap.get(row.sku_code.toLowerCase().trim());
      
      if (sku) {
        group.lines.push({
          sku_id: sku.id,
          sku_code: sku.sku_code,
          quantity: typeof row.quantity === 'string' ? parseInt(row.quantity) : row.quantity
        });
        group.originalRows.push({ ...row, _rowNumber: index + 1 });
      }
    });
    
    return orderGroups;
  }

  /**
   * Validate a single order group
   * Returns {valid: boolean, errors: string[]}
   */
  validateOrderGroup(orderData, lines) {
    const errors = [];
    
    if (!orderData.amazon_order_id) {
      errors.push('Missing amazon_order_id');
    }
    
    if (!orderData.order_date) {
      errors.push('Missing order_date');
    }
    
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (orderData.order_date && !dateRegex.test(orderData.order_date)) {
      errors.push('Invalid order_date format (expected: YYYY-MM-DD)');
    }
    
    if (!orderData.store_id) {
      errors.push('Missing store assignment');
    }
    
    if (lines.length === 0) {
      errors.push('Order has no valid line items');
    }
    
    lines.forEach((line, idx) => {
      if (!line.sku_id) {
        errors.push(`Line ${idx + 1}: SKU not found`);
      }
      if (!line.quantity || line.quantity <= 0) {
        errors.push(`Line ${idx + 1}: Invalid quantity`);
      }
    });
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Process a single order group atomically with retry logic
   * Returns {success: boolean, orderId: string, error?: string, createdIds?: {orderId, lineIds[]}}
   */
  async processOrderGroupAtomic(orderGroup, batchId, existingOrderIds, retryCount = 0) {
    const { orderData, lines, originalRows } = orderGroup;
    const orderKey = `${orderData.store_id}_${orderData.amazon_order_id}`;
    let createdOrderId = null;
    let createdLineIds = [];
    
    try {
      // Validation
      const validation = this.validateOrderGroup(orderData, lines);
      if (!validation.valid) {
        throw new Error(validation.errors.join('; '));
      }
      
      // Check for duplicate
      if (existingOrderIds.has(orderData.amazon_order_id.toLowerCase().trim())) {
        throw new Error(`Duplicate order ID: ${orderData.amazon_order_id} (already exists)`);
      }
      
      // Step 1: Create order header (ATOMIC BOUNDARY)
      const createdOrder = await base44.entities.Order.create({
        tenant_id: this.tenantId,
        amazon_order_id: orderData.amazon_order_id,
        order_date: orderData.order_date,
        store_id: orderData.store_id,
        store_name: orderData.store_name,
        store_color: orderData.store_color,
        status: 'pending',
        import_batch_id: batchId
      });
      
      createdOrderId = createdOrder.id;
      
      // Step 2: Create all order lines (ATOMIC with order header)
      const linesToCreate = lines.map(line => ({
        tenant_id: this.tenantId,
        order_id: createdOrderId,
        sku_id: line.sku_id,
        sku_code: line.sku_code,
        quantity: line.quantity
      }));
      
      // Bulk create lines
      const createdLines = await base44.entities.OrderLine.bulkCreate(linesToCreate);
      createdLineIds = createdLines.map(l => l.id);
      
      // Verify all lines created
      if (createdLineIds.length !== lines.length) {
        throw new Error(`Expected ${lines.length} lines, but only created ${createdLineIds.length}`);
      }
      
      return {
        success: true,
        orderId: orderData.amazon_order_id,
        createdIds: {
          orderId: createdOrderId,
          lineIds: createdLineIds
        },
        rowCount: originalRows.length
      };
      
    } catch (error) {
      const isRateLimitError = 
        error.message?.toLowerCase().includes('rate limit') || 
        error.message?.toLowerCase().includes('429') ||
        error.message?.toLowerCase().includes('too many requests') ||
        error.message?.toLowerCase().includes('timeout');
      
      // Retry logic for rate limit errors
      if (isRateLimitError && retryCount < this.MAX_RETRIES) {
        const delay = this.RETRY_DELAYS[retryCount];
        console.warn(`⏳ Rate limit hit for ${orderData.amazon_order_id}. Retrying in ${delay}ms (attempt ${retryCount + 1}/${this.MAX_RETRIES})...`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Recursive retry
        return this.processOrderGroupAtomic(orderGroup, batchId, existingOrderIds, retryCount + 1);
      }
      
      // Rollback: Delete created order and lines
      if (createdOrderId) {
        console.warn(`🔄 Rolling back order ${orderData.amazon_order_id}...`);
        try {
          // Delete lines first
          for (const lineId of createdLineIds) {
            await base44.entities.OrderLine.delete(lineId);
          }
          // Delete order
          await base44.entities.Order.delete(createdOrderId);
          console.log(`✓ Rollback completed for ${orderData.amazon_order_id}`);
        } catch (rollbackError) {
          console.error(`⚠ Rollback failed for ${orderData.amazon_order_id}:`, rollbackError);
          return {
            success: false,
            orderId: orderData.amazon_order_id,
            error: `Failed AND rollback error: ${error.message}. MANUAL REVIEW REQUIRED.`,
            rowCount: originalRows.length,
            originalRows
          };
        }
      }
      
      // Return failure with details
      return {
        success: false,
        orderId: orderData.amazon_order_id,
        error: isRateLimitError 
          ? `Rate limited / timeout - rolled back (max retries exceeded): ${error.message}`
          : `Transaction rolled back: ${error.message}`,
        rowCount: originalRows.length,
        originalRows
      };
    }
  }

  /**
   * Process all order groups in batches with concurrency control
   * Returns {successCount, failCount, errors: [{orderId, error, rows}]}
   */
  async processAllOrdersAtomic(orderGroups, batchId, existingOrderIds, onProgress) {
    const groups = Array.from(orderGroups.values());
    const totalGroups = groups.length;
    let processed = 0;
    let successCount = 0;
    let failCount = 0;
    const errors = [];
    
    onProgress?.({
      current: 0,
      total: totalGroups,
      successCount: 0,
      failCount: 0,
      message: `Starting atomic import: ${totalGroups} orders...`
    });
    
    // Process in batches with concurrency limit
    for (let i = 0; i < groups.length; i += this.BATCH_SIZE) {
      const batch = groups.slice(i, Math.min(i + this.BATCH_SIZE, groups.length));
      
      // Process batch in parallel
      const batchPromises = batch.map(group => 
        this.processOrderGroupAtomic(group, batchId, existingOrderIds)
      );
      
      const batchResults = await Promise.all(batchPromises);
      
      // Aggregate results
      batchResults.forEach(result => {
        processed++;
        
        if (result.success) {
          successCount++;
        } else {
          failCount++;
          errors.push({
            orderId: result.orderId,
            error: result.error,
            originalRows: result.originalRows
          });
        }
        
        onProgress?.({
          current: processed,
          total: totalGroups,
          successCount,
          failCount,
          message: result.success 
            ? `✓ ${result.orderId} (${result.rowCount} rows)` 
            : `✗ ${result.orderId}: ${result.error}`
        });
      });
    }
    
    return {
      successCount,
      failCount,
      errors
    };
  }
}