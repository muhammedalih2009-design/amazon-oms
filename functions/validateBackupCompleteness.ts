import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { backupJobId } = await req.json();
    
    if (!backupJobId) {
      return Response.json({ error: 'Missing backupJobId' }, { status: 400 });
    }

    // Load backup job
    const backupJob = await base44.asServiceRole.entities.BackupJob.get(backupJobId);
    if (!backupJob) {
      return Response.json({ error: 'Backup job not found' }, { status: 404 });
    }

    const sourceWorkspaceId = backupJob.source_workspace_id;
    const backupData = JSON.parse(backupJob.backup_data);

    // PHASE A: Pre-export count snapshot (from backup stats)
    const backupCounts = backupJob.stats || {};

    // PHASE B: Manifest validation
    const manifest = {
      workspace_id: backupJob.source_workspace_id,
      workspace_name: backupJob.source_workspace_name,
      created_at: backupJob.started_at,
      app_version: '1.0',
      backup_version: backupJob.backup_version || '1.0',
      entities_included: Object.keys(backupData.data).filter(k => backupData.data[k]?.length > 0),
      entity_counts: {
        stores: backupCounts.stores || 0,
        skus: backupCounts.skus || 0,
        currentStock: backupCounts.currentStock || 0,
        stockMovements: backupCounts.stockMovements || 0,
        orders: backupCounts.orders || 0,
        orderLines: backupCounts.orderLines || 0,
        purchases: backupCounts.purchases || 0,
        suppliers: backupCounts.suppliers || 0,
        tasks: backupCounts.tasks || 0,
        checklistItems: backupCounts.checklistItems || 0,
        comments: backupCounts.comments || 0,
        returns: backupCounts.returns || 0,
        importBatches: backupCounts.importBatches || 0
      },
      exclusions: []
    };

    // PHASE C & D: Restore validation (simulated - compare backup data integrity)
    const validationResults = [];

    // Check referential integrity within backup
    const orders = backupData.data.orders || [];
    const orderLines = backupData.data.orderLines || [];
    const skus = backupData.data.skus || [];
    const stockMovements = backupData.data.stockMovements || [];
    const purchases = backupData.data.purchases || [];
    
    const orderIds = new Set(orders.map(o => o.id));
    const skuIds = new Set(skus.map(s => s.id));

    // Validate OrderLine.order_id exists in Orders
    const orphanedOrderLines = orderLines.filter(ol => !orderIds.has(ol.order_id));
    validationResults.push({
      check: 'OrderLine.order_id referential integrity',
      passed: orphanedOrderLines.length === 0,
      details: orphanedOrderLines.length > 0 
        ? `${orphanedOrderLines.length} orphaned order lines found`
        : 'All order lines reference valid orders',
      sample_ids: orphanedOrderLines.slice(0, 5).map(ol => ol.id)
    });

    // Validate OrderLine.sku_id exists in SKUs
    const orphanedOrderLineSKUs = orderLines.filter(ol => !skuIds.has(ol.sku_id));
    validationResults.push({
      check: 'OrderLine.sku_id referential integrity',
      passed: orphanedOrderLineSKUs.length === 0,
      details: orphanedOrderLineSKUs.length > 0
        ? `${orphanedOrderLineSKUs.length} order lines reference missing SKUs`
        : 'All order lines reference valid SKUs',
      sample_ids: orphanedOrderLineSKUs.slice(0, 5).map(ol => ol.id)
    });

    // Validate StockMovement.sku_id exists in SKUs
    const orphanedStockMovements = stockMovements.filter(sm => !skuIds.has(sm.sku_id));
    validationResults.push({
      check: 'StockMovement.sku_id referential integrity',
      passed: orphanedStockMovements.length === 0,
      details: orphanedStockMovements.length > 0
        ? `${orphanedStockMovements.length} stock movements reference missing SKUs`
        : 'All stock movements reference valid SKUs',
      sample_ids: orphanedStockMovements.slice(0, 5).map(sm => sm.id)
    });

    // Validate Purchase.sku_id exists in SKUs
    const orphanedPurchases = purchases.filter(p => !skuIds.has(p.sku_id));
    validationResults.push({
      check: 'Purchase.sku_id referential integrity',
      passed: orphanedPurchases.length === 0,
      details: orphanedPurchases.length > 0
        ? `${orphanedPurchases.length} purchases reference missing SKUs`
        : 'All purchases reference valid SKUs',
      sample_ids: orphanedPurchases.slice(0, 5).map(p => p.id)
    });

    // PHASE E: Completeness verification (compare live workspace vs backup)
    const liveComparison = [];
    
    try {
      const liveOrders = await base44.asServiceRole.entities.Order.filter({ tenant_id: sourceWorkspaceId });
      const liveSkus = await base44.asServiceRole.entities.SKU.filter({ tenant_id: sourceWorkspaceId });
      const livePurchases = await base44.asServiceRole.entities.Purchase.filter({ tenant_id: sourceWorkspaceId });
      const liveStores = await base44.asServiceRole.entities.Store.filter({ tenant_id: sourceWorkspaceId });
      const liveSuppliers = await base44.asServiceRole.entities.Supplier.filter({ tenant_id: sourceWorkspaceId });
      const liveStock = await base44.asServiceRole.entities.CurrentStock.filter({ tenant_id: sourceWorkspaceId });
      const liveStockMovements = await base44.asServiceRole.entities.StockMovement.filter({ tenant_id: sourceWorkspaceId });
      const liveTasks = await base44.asServiceRole.entities.Task.filter({ tenant_id: sourceWorkspaceId });

      liveComparison.push(
        { entity: 'Stores', source_count: liveStores.length, backup_count: backupCounts.stores || 0, match: liveStores.length === (backupCounts.stores || 0) },
        { entity: 'SKUs', source_count: liveSkus.length, backup_count: backupCounts.skus || 0, match: liveSkus.length === (backupCounts.skus || 0) },
        { entity: 'CurrentStock', source_count: liveStock.length, backup_count: backupCounts.currentStock || 0, match: liveStock.length === (backupCounts.currentStock || 0) },
        { entity: 'StockMovements', source_count: liveStockMovements.length, backup_count: backupCounts.stockMovements || 0, match: liveStockMovements.length === (backupCounts.stockMovements || 0) },
        { entity: 'Orders', source_count: liveOrders.length, backup_count: backupCounts.orders || 0, match: liveOrders.length === (backupCounts.orders || 0) },
        { entity: 'Purchases', source_count: livePurchases.length, backup_count: backupCounts.purchases || 0, match: livePurchases.length === (backupCounts.purchases || 0) },
        { entity: 'Suppliers', source_count: liveSuppliers.length, backup_count: backupCounts.suppliers || 0, match: liveSuppliers.length === (backupCounts.suppliers || 0) },
        { entity: 'Tasks', source_count: liveTasks.length, backup_count: backupCounts.tasks || 0, match: liveTasks.length === (backupCounts.tasks || 0) }
      );
    } catch (err) {
      console.warn('Live comparison failed:', err.message);
    }

    // Generate final report
    const report = {
      backup_job_id: backupJobId,
      workspace_id: sourceWorkspaceId,
      workspace_name: backupJob.source_workspace_name,
      validated_at: new Date().toISOString(),
      validated_by: user.email,
      manifest,
      integrity_checks: validationResults,
      completeness_comparison: liveComparison,
      overall_status: validationResults.every(r => r.passed) ? 'PASSED' : 'FAILED',
      summary: {
        total_checks: validationResults.length,
        passed_checks: validationResults.filter(r => r.passed).length,
        failed_checks: validationResults.filter(r => !r.passed).length,
        entities_in_backup: manifest.entities_included.length,
        total_records: Object.values(manifest.entity_counts).reduce((sum, count) => sum + count, 0)
      }
    };

    return Response.json(report);
  } catch (error) {
    console.error('Validate backup error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});