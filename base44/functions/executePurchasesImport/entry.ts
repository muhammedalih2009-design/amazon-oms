import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { parse as parseDate } from 'npm:date-fns@3.6.0';

const CHUNK_SIZE = 50;

// Cancellation check helper
async function checkCancellation(base44, jobId) {
  try {
    const job = await base44.asServiceRole.entities.BackgroundJob.get(jobId);
    return job?.status === 'cancelling' || job?.cancel_requested_at;
  } catch {
    return false;
  }
}

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

    // Check if already cancelled
    if (await checkCancellation(base44, job_id)) {
      console.log(`[executePurchasesImport] Job ${job_id} cancelled before start`);
      await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
        status: 'cancelled',
        completed_at: new Date().toISOString(),
        error_message: 'Cancelled by user'
      });
      return Response.json({ ok: true, cancelled: true });
    }

    // Update status to running with heartbeat
    await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
      status: 'running',
      started_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString()
    });

    const { tenant_id } = job;
    // E) FIX: Support both old (rows_json) and new (rows) formats
    const rows = job.params?.rows || (job.params?.rows_json ? JSON.parse(job.params.rows_json) : []);
    
    if (!rows || rows.length === 0) {
      throw new Error('No rows to process');
    }

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

    let currentIndex = job.processed_count || 0;
    let successCount = job.success_count || 0;
    let failCount = job.failed_count || 0;

    // Process rows in chunks
    while (currentIndex < rows.length) {
      // Check for cancellation every chunk
      if (await checkCancellation(base44, job_id)) {
        console.log(`[executePurchasesImport] Job ${job_id} cancelled during processing`);
        await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
          status: 'cancelled',
          completed_at: new Date().toISOString(),
          processed_count: successCount + failCount,
          success_count: successCount,
          failed_count: failCount,
          progress_percent: Math.round(((successCount + failCount) / rows.length) * 100),
          error_message: 'Cancelled by user during import'
        });
        return Response.json({ ok: true, cancelled: true });
      }

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
            continue;
          }

          // Parse quantity
          const quantity = parseFloat(row.quantity);
          if (isNaN(quantity) || quantity <= 0) {
            failCount++;
            continue;
          }

          // Parse purchase date
          let purchaseDate = row.purchase_date || new Date().toISOString().split('T')[0];
          try {
            const parsedDate = parseDate(purchaseDate, 'yyyy-MM-dd', new Date());
            purchaseDate = parsedDate.toISOString().split('T')[0];
          } catch (e) {
            failCount++;
            continue;
          }

          // Parse cost per unit
          let costPerUnit = parseFloat(row.unit_price);
          if (isNaN(costPerUnit) || costPerUnit < 0) {
            failCount++;
            continue;
          }

          const totalCost = costPerUnit * quantity;

          // Resolve supplier
          const supplierName = (row.supplier_name || '').trim();
          let supplierData = null;
          if (supplierName) {
            supplierData = supplierMap[supplierName.toLowerCase()];
          }

          // Build purchase record
          const purchase = {
            tenant_id,
            sku_id: skuData.id,
            sku_code: skuCode,
            quantity_purchased: quantity,
            cost_per_unit: costPerUnit,
            total_cost: totalCost,
            purchase_date: purchaseDate,
            quantity_remaining: quantity,
            supplier_id: supplierData?.id || null,
            supplier_name: supplierData?.supplier_name || supplierName || null
          };

          purchasesToCreate.push(purchase);
          stockUpdates[skuData.id] = (stockUpdates[skuData.id] || 0) + quantity;
          successCount++;
        } catch (err) {
          failCount++;
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
      
      // Update job progress with standard fields and heartbeat
      await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
        processed_count: successCount + failCount,
        success_count: successCount,
        failed_count: failCount,
        progress_percent: Math.round(((successCount + failCount) / rows.length) * 100),
        last_heartbeat_at: new Date().toISOString()
      });
    }

    // Mark complete
    await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      processed_count: successCount + failCount,
      success_count: successCount,
      failed_count: failCount,
      progress_percent: 100
    });

    return Response.json({
      ok: true,
      message: 'Import completed',
      success: successCount,
      failed: failCount
    });

  } catch (error) {
    console.error('[Execute Purchases Import] Error:', error);

    try {
      const payload = await req.json();
      const job_id = payload?.job_id;

      // Mark job as failed
      if (job_id) {
        try {
          const base44 = createClientFromRequest(req);
          await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
            status: 'failed',
            error_message: error.message || 'Unknown error',
            completed_at: new Date().toISOString()
          });
        } catch (updateErr) {
          console.error('[Execute Purchases Import] Failed to update job status:', updateErr);
        }
      }
    } catch (parseErr) {
      console.error('[Execute Purchases Import] Error parsing request:', parseErr);
    }

    return Response.json({
      error: error.message || 'Import failed'
    }, { status: 500 });
  }
});