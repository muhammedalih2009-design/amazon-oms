import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { parse as parseDate } from 'npm:date-fns@3.6.0';

const CHUNK_SIZE = 50;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { job_id } = await req.json();

    if (!job_id) {
      return Response.json({ error: 'job_id required' }, { status: 400 });
    }

    // Fetch job
    const job = await base44.asServiceRole.entities.BackgroundJob.get(job_id);
    if (!job) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    if (job.status === 'cancelled') {
      return Response.json({ ok: true, message: 'Job cancelled' });
    }

    const { tenant_id } = job;
    const rows = job.params?.rows || (job.params?.rows_json ? JSON.parse(job.params.rows_json) : []);

    // Preload data once
    const [skus, suppliers, allPurchases, currentStock] = await Promise.all([
      base44.asServiceRole.entities.SKU.filter({ tenant_id }),
      base44.asServiceRole.entities.Supplier.filter({ tenant_id }),
      base44.asServiceRole.entities.Purchase.filter({ tenant_id }),
      base44.asServiceRole.entities.CurrentStock.filter({ tenant_id })
    ]);

    // Build lookup maps
    const skuMap = {};
    skus.forEach(sku => {
      const key = (sku.sku_code || '').trim().toLowerCase();
      if (key) {
        skuMap[key] = sku;
      }
    });

    const supplierMap = {};
    suppliers.forEach(s => {
      const key = (s.supplier_name || '').trim().toLowerCase();
      if (key) {
        supplierMap[key] = s;
      }
    });

    // Last purchase cost per SKU
    const lastPurchaseMap = {};
    allPurchases.forEach(p => {
      const key = (p.sku_code || '').trim().toLowerCase();
      if (key && p.cost_per_unit > 0) {
        if (!lastPurchaseMap[key] || new Date(p.purchase_date) > new Date(lastPurchaseMap[key].date)) {
          lastPurchaseMap[key] = {
            cost: p.cost_per_unit,
            supplier_id: p.supplier_id,
            supplier_name: p.supplier_name,
            date: p.purchase_date
          };
        }
      }
    });

    let currentIndex = job.current_index || 0;
    let successCount = job.success || 0;
    let failCount = job.failed || 0;
    const failedRows = [];

    // Process rows in chunks
    while (currentIndex < rows.length) {
      const chunkEnd = Math.min(currentIndex + CHUNK_SIZE, rows.length);
      const chunk = rows.slice(currentIndex, chunkEnd);

      const purchasesToCreate = [];
      const stockUpdates = {};

      for (let i = 0; i < chunk.length; i++) {
        const row = chunk[i];
        const globalIdx = currentIndex + i;

        try {
          // Validate SKU
          const skuCode = (row.sku_code || '').trim();
          const skuData = skuMap[skuCode.toLowerCase()];
          if (!skuData) {
            failCount++;
            failedRows.push({
              row: globalIdx + 1,
              sku_code: skuCode,
              reason: 'SKU not found'
            });
            continue;
          }

          // Parse quantity
          const qty = parseInt(row.quantity);
          if (isNaN(qty) || qty < 1) {
            failCount++;
            failedRows.push({
              row: globalIdx + 1,
              sku_code: skuCode,
              reason: 'Invalid quantity'
            });
            continue;
          }

          // Resolve unit price
          let unitPrice = null;
          if (row.unit_price) {
            const p = parseFloat(row.unit_price);
            if (!isNaN(p) && p >= 0) {
              unitPrice = p;
            }
          }
          
          if (!unitPrice) {
            // Fallback: use last purchase cost or SKU cost
            const lastPurch = lastPurchaseMap[skuCode.toLowerCase()];
            unitPrice = (lastPurch?.cost) || (skuData.cost_price || 0);
            if (unitPrice <= 0) {
              failCount++;
              failedRows.push({
                row: globalIdx + 1,
                sku_code: skuCode,
                reason: 'No unit price and no fallback available'
              });
              continue;
            }
          }

          // Resolve supplier
          let supplierId = null;
          let supplierName = (row.supplier_name || '').trim();
          
          if (!supplierName) {
            const lastPurch = lastPurchaseMap[skuCode.toLowerCase()];
            if (lastPurch?.supplier_id) {
              supplierId = lastPurch.supplier_id;
              supplierName = lastPurch.supplier_name;
            } else if (skuData.supplier_id) {
              supplierId = skuData.supplier_id;
              const sup = suppliers.find(s => s.id === supplierId);
              if (sup) supplierName = sup.supplier_name;
            }
          } else {
            // Lookup by name
            const sup = supplierMap[supplierName.toLowerCase()];
            if (sup) {
              supplierId = sup.id;
            }
          }

          // Parse date
          let purchaseDate = new Date().toISOString().split('T')[0]; // Default today
          if (row.purchase_date) {
            const dateStr = row.purchase_date.trim();
            const parsed = parseDate(dateStr, 'yyyy-MM-dd', new Date());
            if (!isNaN(parsed.getTime())) {
              purchaseDate = parsed.toISOString().split('T')[0];
            }
          }

          // Create purchase record
          purchasesToCreate.push({
            tenant_id,
            sku_id: skuData.id,
            sku_code: skuData.sku_code,
            quantity_purchased: qty,
            total_cost: qty * unitPrice,
            cost_per_unit: unitPrice,
            purchase_date: purchaseDate,
            supplier_id: supplierId || null,
            supplier_name: supplierName || null,
            quantity_remaining: qty
          });

          // Track stock update
          if (!stockUpdates[skuData.id]) {
            stockUpdates[skuData.id] = 0;
          }
          stockUpdates[skuData.id] += qty;

          successCount++;

        } catch (error) {
          failCount++;
          failedRows.push({
            row: globalIdx + 1,
            sku_code: row.sku_code || '?',
            reason: error.message || 'Processing error'
          });
        }
      }

      // Write purchases in batch
      if (purchasesToCreate.length > 0) {
        await base44.asServiceRole.entities.Purchase.bulkCreate(purchasesToCreate);
      }

      // Update stock
      for (const [skuId, addQty] of Object.entries(stockUpdates)) {
        const existing = currentStock.find(s => s.sku_id === skuId);
        if (existing) {
          await base44.asServiceRole.entities.CurrentStock.update(existing.id, {
            quantity_available: (existing.quantity_available || 0) + addQty
          });
        } else {
          await base44.asServiceRole.entities.CurrentStock.create({
            tenant_id,
            sku_id: skuId,
            sku_code: skus.find(s => s.id === skuId)?.sku_code || '',
            quantity_available: addQty
          });
        }
      }

      currentIndex = chunkEnd;

      // Update job progress
      await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
        processed: currentIndex,
        success: successCount,
        failed: failCount,
        current_index: currentIndex,
        job_data: JSON.stringify({
          ...jobData,
          failed_rows: failedRows
        })
      });

      // Check cancellation
      const updatedJob = await base44.asServiceRole.entities.BackgroundJob.get(job_id);
      if (updatedJob.status === 'cancelled') {
        return Response.json({ ok: true, message: 'Import cancelled' });
      }
    }

    // Mark complete
    await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
      status: 'completed',
      completed_at: new Date().toISOString()
    });

    return Response.json({
      ok: true,
      message: 'Import completed',
      success: successCount,
      failed: failCount,
      failed_rows: failedRows
    });

  } catch (error) {
    console.error('[Execute Purchases Import] Error:', error);

    // Mark job as failed
    if (job_id) {
      const job = await base44.asServiceRole.entities.BackgroundJob.get(job_id);
      if (job) {
        await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
          status: 'failed',
          error_message: error.message || 'Unknown error'
        });
      }
    }

    return Response.json({
      error: error.message || 'Import failed'
    }, { status: 500 });
  }
});