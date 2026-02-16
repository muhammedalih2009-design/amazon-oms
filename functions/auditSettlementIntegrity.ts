import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id, import_id } = await req.json();

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

    console.log('[auditSettlementIntegrity] Starting audit for workspace:', workspace_id);

    // Step 1: Check settlement imports
    const imports = await base44.asServiceRole.entities.SettlementImport.filter({
      tenant_id: workspace_id,
      status: 'completed'
    });

    console.log(`[auditSettlementIntegrity] Found ${imports.length} completed imports`);

    const targetImport = import_id 
      ? imports.find(i => i.id === import_id)
      : imports.sort((a, b) => new Date(b.created_date) - new Date(a.created_date))[0];

    if (!targetImport) {
      return Response.json({
        status: 'NO_DATA',
        message: 'No completed settlement imports found',
        diagnostics: {
          imports_count: imports.length,
          completed_imports: imports.length
        }
      });
    }

    console.log('[auditSettlementIntegrity] Using import:', targetImport.id);

    // Step 2: Check settlement rows
    const allRows = await base44.asServiceRole.entities.SettlementRow.filter({
      tenant_id: workspace_id,
      settlement_import_id: targetImport.id
    });

    const activeRows = allRows.filter(r => !r.is_deleted);
    const deletedRows = allRows.filter(r => r.is_deleted);

    console.log(`[auditSettlementIntegrity] Rows - Total: ${allRows.length}, Active: ${activeRows.length}, Deleted: ${deletedRows.length}`);

    // Step 3: Check if rows match import expectation
    const expectedRows = targetImport.rows_count || 0;
    const rowsMismatch = activeRows.length !== expectedRows;

    // Step 4: Calculate KPIs from active rows
    let calculatedRevenue = 0;
    let calculatedCogs = 0;
    let matchedOrderCount = 0;

    // Get all orders for COGS lookup
    const orders = await base44.asServiceRole.entities.Order.filter({
      tenant_id: workspace_id,
      is_deleted: false
    });

    console.log(`[auditSettlementIntegrity] Found ${orders.length} active orders`);

    const orderMap = new Map(orders.map(o => [o.amazon_order_id.trim().toUpperCase(), o]));

    for (const row of activeRows) {
      calculatedRevenue += row.total || 0;

      // Match order for COGS
      const normalizedOrderId = row.order_id.trim().toUpperCase();
      const matchedOrder = orderMap.get(normalizedOrderId);
      
      if (matchedOrder) {
        matchedOrderCount++;
        calculatedCogs += (matchedOrder.total_cost || 0) / activeRows.filter(r => r.order_id === row.order_id).length;
      }
    }

    const calculatedProfit = calculatedRevenue - calculatedCogs;
    const calculatedMargin = calculatedRevenue !== 0 ? calculatedProfit / calculatedRevenue : 0;

    // Step 5: Compare with cached totals
    const cachedTotals = targetImport.totals_cached_json || {};
    const kpiMismatch = 
      Math.abs((cachedTotals.total_revenue || 0) - calculatedRevenue) > 0.01 ||
      Math.abs((cachedTotals.total_cogs || 0) - calculatedCogs) > 0.01;

    // Step 6: Check for zero KPIs when rows exist
    const zeroKpisWithData = activeRows.length > 0 && (
      (cachedTotals.total_revenue || 0) === 0 ||
      (cachedTotals.total_cogs || 0) === 0
    );

    console.log('[auditSettlementIntegrity] KPI Comparison:', {
      cached: cachedTotals,
      calculated: {
        total_revenue: calculatedRevenue,
        total_cogs: calculatedCogs,
        total_profit: calculatedProfit,
        margin: calculatedMargin
      }
    });

    // Step 7: Build integrity report
    const issues = [];
    if (rowsMismatch) {
      issues.push({
        type: 'ROWS_MISMATCH',
        severity: 'HIGH',
        message: `Expected ${expectedRows} rows, found ${activeRows.length}`,
        expected: expectedRows,
        actual: activeRows.length
      });
    }

    if (kpiMismatch) {
      issues.push({
        type: 'KPI_MISMATCH',
        severity: 'HIGH',
        message: 'Cached KPIs do not match calculated values',
        cached: cachedTotals,
        calculated: {
          total_revenue: calculatedRevenue,
          total_cogs: calculatedCogs,
          total_profit: calculatedProfit,
          margin: calculatedMargin
        }
      });
    }

    if (zeroKpisWithData) {
      issues.push({
        type: 'ZERO_KPIS_WITH_DATA',
        severity: 'CRITICAL',
        message: 'KPIs are zero but settlement rows exist',
        rows_count: activeRows.length,
        cached_kpis: cachedTotals
      });
    }

    const status = issues.length === 0 ? 'HEALTHY' : 'ISSUES_FOUND';

    return Response.json({
      status,
      workspace_id,
      import_id: targetImport.id,
      import_created_at: targetImport.created_date,
      summary: {
        total_imports: imports.length,
        total_rows: allRows.length,
        active_rows: activeRows.length,
        deleted_rows: deletedRows.length,
        expected_rows: expectedRows,
        matched_orders: matchedOrderCount,
        total_orders: orders.length
      },
      kpis: {
        cached: cachedTotals,
        calculated: {
          total_revenue: calculatedRevenue,
          total_cogs: calculatedCogs,
          total_profit: calculatedProfit,
          margin: calculatedMargin
        },
        mismatch: kpiMismatch
      },
      issues,
      recommendations: issues.length > 0 ? [
        rowsMismatch ? 'Run rebuildSettlementRows to fix row count mismatch' : null,
        kpiMismatch || zeroKpisWithData ? 'Recalculate and cache KPIs from active rows' : null
      ].filter(Boolean) : []
    });

  } catch (error) {
    console.error('[auditSettlementIntegrity] Error:', error);
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});