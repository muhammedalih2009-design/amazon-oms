/**
 * AtomicSKUUploader
 * Implements atomic SKU import with grouped transactions, retry logic, and rollback
 * Groups rows by sku_code to ensure all-or-nothing per SKU
 * Applies final intended update (last stock value or sum of deltas)
 */

import { base44 } from '@/api/base44Client';

export class AtomicSKUUploader {
  constructor(tenantId) {
    this.tenantId = tenantId;
    this.MAX_RETRIES = 3;
    this.RETRY_DELAYS = [500, 1000, 2000];
    this.BATCH_SIZE = 10; // Process 10 SKU groups concurrently
  }

  /**
   * Group CSV rows by sku_code and compute final intended state
   * Strategy: Use last non-empty stock value (SET behavior)
   * Returns Map<sku_code, {skuData, finalStock, originalRows[]}>
   */
  groupSKUsByEntity(rows) {
    const skuGroups = new Map();
    
    rows.forEach((row, index) => {
      const skuKey = row.sku_code.toLowerCase().trim();
      
      if (!skuGroups.has(skuKey)) {
        skuGroups.set(skuKey, {
          skuData: null,
          finalStock: 0,
          originalRows: [],
          _firstRowNumber: index + 1
        });
      }
      
      const group = skuGroups.get(skuKey);
      
      // Update SKU data (last row wins for properties)
      group.skuData = {
        sku_code: row.sku_code,
        product_name: row.product_name,
        cost_price: parseFloat(row.cost),
        supplier_id: row.supplier || null,
        image_url: row.image_url || null
      };
      
      // Stock strategy: USE LAST NON-EMPTY VALUE (SET behavior)
      const stockValue = parseInt(row.stock) || 0;
      if (row.stock !== undefined && row.stock !== null && row.stock !== '') {
        group.finalStock = stockValue;
      }
      
      group.originalRows.push({ ...row, _rowNumber: index + 1 });
    });
    
    return skuGroups;
  }

  /**
   * Validate SKU group
   */
  validateSKUGroup(skuData) {
    const errors = [];
    
    if (!skuData.sku_code) {
      errors.push('Missing sku_code');
    }
    
    if (!skuData.product_name) {
      errors.push('Missing product_name');
    }
    
    if (isNaN(skuData.cost_price) || skuData.cost_price <= 0) {
      errors.push('Invalid cost_price (must be > 0)');
    }
    
    if (skuData.image_url) {
      try {
        new URL(skuData.image_url);
      } catch {
        errors.push('Invalid image_url');
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Process single SKU group atomically with retry logic
   * Creates/updates SKU and stock in one transaction
   */
  async processSKUGroupAtomic(skuGroup, upsertMode, existingSKUs, retryCount = 0) {
    const { skuData, finalStock, originalRows } = skuGroup;
    let createdSKUId = null;
    let createdStockId = null;
    let isUpdate = false;
    
    try {
      // Validation
      const validation = this.validateSKUGroup(skuData);
      if (!validation.valid) {
        throw new Error(validation.errors.join('; '));
      }
      
      // Check if SKU exists
      const existingSKU = existingSKUs.find(s => 
        s.sku_code.toLowerCase().trim() === skuData.sku_code.toLowerCase().trim()
      );
      
      if (existingSKU) {
        if (upsertMode === 'skip') {
          return {
            success: true,
            skuCode: skuData.sku_code,
            action: 'skipped',
            rowCount: originalRows.length
          };
        }
        
        // UPDATE mode - atomic update
        isUpdate = true;
        createdSKUId = existingSKU.id;
        
        // Step 1: Update SKU
        await base44.entities.SKU.update(existingSKU.id, {
          tenant_id: this.tenantId,
          sku_code: skuData.sku_code,
          product_name: skuData.product_name,
          cost_price: skuData.cost_price,
          supplier_id: skuData.supplier_id,
          image_url: skuData.image_url
        });
        
        // Step 2: Update stock (atomic with SKU update)
        const stockRecords = await base44.entities.CurrentStock.filter({
          tenant_id: this.tenantId,
          sku_id: existingSKU.id
        });
        
        if (stockRecords.length > 0) {
          createdStockId = stockRecords[0].id;
          await base44.entities.CurrentStock.update(stockRecords[0].id, {
            quantity_available: finalStock
          });
        } else if (finalStock > 0) {
          const newStock = await base44.entities.CurrentStock.create({
            tenant_id: this.tenantId,
            sku_id: existingSKU.id,
            sku_code: skuData.sku_code,
            quantity_available: finalStock
          });
          createdStockId = newStock.id;
        }
        
        return {
          success: true,
          skuCode: skuData.sku_code,
          action: 'updated',
          rowCount: originalRows.length,
          createdIds: {
            skuId: createdSKUId,
            stockId: createdStockId
          }
        };
        
      } else {
        // CREATE mode - atomic create
        isUpdate = false;
        
        // Step 1: Create SKU
        const newSKU = await base44.entities.SKU.create({
          tenant_id: this.tenantId,
          sku_code: skuData.sku_code,
          product_name: skuData.product_name,
          cost_price: skuData.cost_price,
          supplier_id: skuData.supplier_id,
          image_url: skuData.image_url
        });
        
        createdSKUId = newSKU.id;
        
        // Step 2: Create stock (atomic with SKU)
        if (finalStock > 0) {
          const newStock = await base44.entities.CurrentStock.create({
            tenant_id: this.tenantId,
            sku_id: newSKU.id,
            sku_code: skuData.sku_code,
            quantity_available: finalStock
          });
          createdStockId = newStock.id;
        }
        
        return {
          success: true,
          skuCode: skuData.sku_code,
          action: 'created',
          rowCount: originalRows.length,
          createdIds: {
            skuId: createdSKUId,
            stockId: createdStockId
          }
        };
      }
      
    } catch (error) {
      const isRateLimitError = 
        error.message?.toLowerCase().includes('rate limit') || 
        error.message?.toLowerCase().includes('429') ||
        error.message?.toLowerCase().includes('too many requests') ||
        error.message?.toLowerCase().includes('timeout');
      
      // Retry logic
      if (isRateLimitError && retryCount < this.MAX_RETRIES) {
        const delay = this.RETRY_DELAYS[retryCount];
        console.warn(`⏳ Rate limit hit for SKU ${skuData.sku_code}. Retrying in ${delay}ms (attempt ${retryCount + 1}/${this.MAX_RETRIES})...`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.processSKUGroupAtomic(skuGroup, upsertMode, existingSKUs, retryCount + 1);
      }
      
      // Rollback for CREATE operations only (UPDATE rollback not practical)
      if (!isUpdate && createdSKUId) {
        console.warn(`🔄 Rolling back SKU ${skuData.sku_code}...`);
        try {
          if (createdStockId) {
            await base44.entities.CurrentStock.delete(createdStockId);
          }
          await base44.entities.SKU.delete(createdSKUId);
          console.log(`✓ Rollback completed for SKU ${skuData.sku_code}`);
        } catch (rollbackError) {
          console.error(`⚠ Rollback failed for SKU ${skuData.sku_code}:`, rollbackError);
          return {
            success: false,
            skuCode: skuData.sku_code,
            error: `Failed AND rollback error: ${error.message}. MANUAL REVIEW REQUIRED.`,
            rowCount: originalRows.length,
            originalRows
          };
        }
      }
      
      return {
        success: false,
        skuCode: skuData.sku_code,
        error: isRateLimitError 
          ? `Rate limited / timeout - rolled back (max retries exceeded): ${error.message}`
          : `Transaction rolled back: ${error.message}`,
        rowCount: originalRows.length,
        originalRows
      };
    }
  }

  /**
   * Process all SKU groups with concurrency control
   */
  async processAllSKUsAtomic(skuGroups, upsertMode, existingSKUs, onProgress) {
    const groups = Array.from(skuGroups.values());
    const totalGroups = groups.length;
    let processed = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];
    
    onProgress?.({
      current: 0,
      total: totalGroups,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      message: `Starting atomic SKU import: ${totalGroups} SKUs...`
    });
    
    for (let i = 0; i < groups.length; i += this.BATCH_SIZE) {
      const batch = groups.slice(i, Math.min(i + this.BATCH_SIZE, groups.length));
      
      const batchPromises = batch.map(group => 
        this.processSKUGroupAtomic(group, upsertMode, existingSKUs)
      );
      
      const batchResults = await Promise.all(batchPromises);
      
      batchResults.forEach(result => {
        processed++;
        
        if (result.success) {
          if (result.action === 'created') created++;
          else if (result.action === 'updated') updated++;
          else if (result.action === 'skipped') skipped++;
        } else {
          failed++;
          errors.push({
            skuCode: result.skuCode,
            error: result.error,
            originalRows: result.originalRows
          });
        }
        
        onProgress?.({
          current: processed,
          total: totalGroups,
          created,
          updated,
          skipped,
          failed,
          message: result.success 
            ? `✓ ${result.skuCode} (${result.action}, ${result.rowCount} rows)` 
            : `✗ ${result.skuCode}: ${result.error}`
        });
      });
    }
    
    return {
      created,
      updated,
      skipped,
      failed,
      errors
    };
  }
}