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
    const orders = backupData.data?.orders || [];
    const orderLines = backupData.data?.orderLines || [];
    const skus = backupData.data?.skus || [];
    const stores = backupData.data?.stores || [];
    const suppliers = backupData.data?.suppliers || [];
    const stockMovements = backupData.data?.stockMovements || [];
    const purchases = backupData.data?.purchases || [];
    const profitabilityLines = backupData.data?.profitabilityLines || [];
    const purchaseCarts = backupData.data?.purchaseCarts || [];
    
    const orderIds = new Set(orders.map(o => o.id));
    const skuIds = new Set(skus.map(s => s.id));
    const storeIds = new Set(stores.map(s => s.id));
    const supplierIds = new Set(suppliers.map(s => s.id));

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

    // Validate Order.store_id exists in Stores
    const orphanedOrderStores = orders.filter(o => o.store_id && !storeIds.has(o.store_id));
    validationResults.push({
      check: 'Order.store_id referential integrity',
      passed: orphanedOrderStores.length === 0,
      details: orphanedOrderStores.length > 0
        ? `${orphanedOrderStores.length} orders reference missing stores`
        : 'All orders reference valid stores',
      sample_ids: orphanedOrderStores.slice(0, 5).map(o => o.id)
    });

    // Validate SKU.supplier_id exists in Suppliers
    const orphanedSKUSuppliers = skus.filter(s => s.supplier_id && !supplierIds.has(s.supplier_id));
    validationResults.push({
      check: 'SKU.supplier_id referential integrity',
      passed: orphanedSKUSuppliers.length === 0,
      details: orphanedSKUSuppliers.length > 0
        ? `${orphanedSKUSuppliers.length} SKUs reference missing suppliers`
        : 'All SKUs with suppliers reference valid suppliers',
      sample_ids: orphanedSKUSuppliers.slice(0, 5).map(s => s.id)
    });

    // Validate ProfitabilityLine relations
    const orphanedProfitOrders = profitabilityLines.filter(pl => pl.order_id && !orderIds.has(pl.order_id));
    validationResults.push({
      check: 'ProfitabilityLine.order_id referential integrity',
      passed: orphanedProfitOrders.length === 0,
      details: orphanedProfitOrders.length > 0
        ? `${orphanedProfitOrders.length} profitability lines reference missing orders`
        : 'All profitability lines reference valid orders',
      sample_ids: orphanedProfitOrders.slice(0, 5).map(pl => pl.id)
    });

    // Validate PurchaseCart.sku_id exists in SKUs
    const orphanedCartSKUs = purchaseCarts.filter(pc => pc.sku_id && !skuIds.has(pc.sku_id));
    validationResults.push({
      check: 'PurchaseCart.sku_id referential integrity',
      passed: orphanedCartSKUs.length === 0,
      details: orphanedCartSKUs.length > 0
        ? `${orphanedCartSKUs.length} purchase cart items reference missing SKUs`
        : 'All purchase cart items reference valid SKUs',
      sample_ids: orphanedCartSKUs.slice(0, 5).map(pc => pc.id)
    });

    // Critical UI features validation
    validationResults.push({
      check: 'SKU supplier linkage completeness',
      passed: skus.length > 0 ? skus.filter(s => s.supplier_id).length > 0 : true,
      details: `${skus.filter(s => s.supplier_id).length}/${skus.length} SKUs have supplier references`,
      sample_ids: []
    });

    validationResults.push({
      check: 'Stock movement history present',
      passed: stockMovements.length > 0 || skus.length === 0,
      details: `${stockMovements.length} stock movements for ${skus.length} SKUs`,
      sample_ids: []
    });

    validationResults.push({
      check: 'Profitability data completeness',
      passed: profitabilityLines.length > 0 || orders.length === 0,
      details: `${profitabilityLines.length} profitability lines for ${orders.length} orders`,
      sample_ids: []
    });

    validationResults.push({
      check: 'Purchase batch/cart history present',
      passed: purchaseCarts.length > 0 || purchases.length === 0,
      details: `${purchaseCarts.length} purchase cart items for workspace`,
      sample_ids: []
    });

    // PHASE E: Completeness verification (compare live workspace vs backup)
    const liveComparison = [];
    
    try {
      const liveData = await Promise.all([
        base44.asServiceRole.entities.Store.filter({ tenant_id: sourceWorkspaceId }),
        base44.asServiceRole.entities.Supplier.filter({ tenant_id: sourceWorkspaceId }),
        base44.asServiceRole.entities.SKU.filter({ tenant_id: sourceWorkspaceId }),
        base44.asServiceRole.entities.CurrentStock.filter({ tenant_id: sourceWorkspaceId }),
        base44.asServiceRole.entities.StockMovement.filter({ tenant_id: sourceWorkspaceId }),
        base44.asServiceRole.entities.Order.filter({ tenant_id: sourceWorkspaceId }),
        base44.asServiceRole.entities.OrderLine.filter({ tenant_id: sourceWorkspaceId }),
        base44.asServiceRole.entities.Purchase.filter({ tenant_id: sourceWorkspaceId }),
        base44.asServiceRole.entities.PurchaseRequest.filter({ tenant_id: sourceWorkspaceId }),
        base44.asServiceRole.entities.PurchaseCart.filter({ tenant_id: sourceWorkspaceId }),
        base44.asServiceRole.entities.ProfitabilityLine.filter({ tenant_id: sourceWorkspaceId }),
        base44.asServiceRole.entities.Task.filter({ tenant_id: sourceWorkspaceId })
      ]);

      liveComparison.push(
        { entity: 'Stores', source_count: liveData[0].length, backup_count: backupCounts.stores || 0, match: liveData[0].length === (backupCounts.stores || 0) },
        { entity: 'Suppliers', source_count: liveData[1].length, backup_count: backupCounts.suppliers || 0, match: liveData[1].length === (backupCounts.suppliers || 0) },
        { entity: 'SKUs', source_count: liveData[2].length, backup_count: backupCounts.skus || 0, match: liveData[2].length === (backupCounts.skus || 0) },
        { entity: 'CurrentStock', source_count: liveData[3].length, backup_count: backupCounts.currentStock || 0, match: liveData[3].length === (backupCounts.currentStock || 0) },
        { entity: 'StockMovements', source_count: liveData[4].length, backup_count: backupCounts.stockMovements || 0, match: liveData[4].length === (backupCounts.stockMovements || 0) },
        { entity: 'Orders', source_count: liveData[5].length, backup_count: backupCounts.orders || 0, match: liveData[5].length === (backupCounts.orders || 0) },
        { entity: 'OrderLines', source_count: liveData[6].length, backup_count: backupCounts.orderLines || 0, match: liveData[6].length === (backupCounts.orderLines || 0) },
        { entity: 'Purchases', source_count: liveData[7].length, backup_count: backupCounts.purchases || 0, match: liveData[7].length === (backupCounts.purchases || 0) },
        { entity: 'PurchaseRequests', source_count: liveData[8].length, backup_count: backupCounts.purchaseRequests || 0, match: liveData[8].length === (backupCounts.purchaseRequests || 0) },
        { entity: 'PurchaseCarts', source_count: liveData[9].length, backup_count: backupCounts.purchaseCarts || 0, match: liveData[9].length === (backupCounts.purchaseCarts || 0) },
        { entity: 'ProfitabilityLines', source_count: liveData[10].length, backup_count: backupCounts.profitabilityLines || 0, match: liveData[10].length === (backupCounts.profitabilityLines || 0) },
        { entity: 'Tasks', source_count: liveData[11].length, backup_count: backupCounts.tasks || 0, match: liveData[11].length === (backupCounts.tasks || 0) }
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