import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { workspace_id } = body;

    if (!workspace_id) {
      return Response.json({ error: 'Missing workspace_id' }, { status: 400 });
    }

    // Verify admin access
    const membership = await base44.asServiceRole.entities.Membership.filter({
      tenant_id: workspace_id,
      user_id: user.id
    });

    if (membership.length === 0 || (membership[0].role !== 'owner' && membership[0].role !== 'admin')) {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get all completed imports for workspace
    const imports = await base44.asServiceRole.entities.SettlementImport.filter({
      tenant_id: workspace_id,
      status: { $in: ['completed', 'completed_with_errors'] }
    });

    const results = [];

    for (const imp of imports) {
      try {
        // Count actual rows
        const actualRows = await base44.asServiceRole.entities.SettlementRow.filter({
          settlement_import_id: imp.id
        });

        // Parse expected
        let expectedRows = 0;
        try {
          const parsed = JSON.parse(imp.parsed_rows_json || '[]');
          expectedRows = parsed.length;
        } catch (err) {
          results.push({
            import_id: imp.id,
            file_name: imp.file_name,
            status: 'PARSE_ERROR',
            error: err.message
          });
          continue;
        }

        const beforeCount = actualRows.length;
        const needsRepair = beforeCount < expectedRows * 0.95;

        if (!needsRepair) {
          results.push({
            import_id: imp.id,
            file_name: imp.file_name,
            status: 'OK',
            before_count: beforeCount,
            after_count: beforeCount,
            repaired: false
          });
          continue;
        }

        // Trigger rebuild
        const rebuildResponse = await base44.functions.invoke('rebuildSettlementRows', {
          workspace_id,
          import_id: imp.id
        });

        results.push({
          import_id: imp.id,
          file_name: imp.file_name,
          status: 'REPAIRED',
          before_count: beforeCount,
          after_count: rebuildResponse.data.rows_existing_before + rebuildResponse.data.rows_created,
          rows_created: rebuildResponse.data.rows_created,
          repaired: true
        });
      } catch (err) {
        results.push({
          import_id: imp.id,
          file_name: imp.file_name,
          status: 'REPAIR_FAILED',
          error: err.message
        });
      }
    }

    return Response.json({
      workspace_id,
      total_imports: imports.length,
      repaired: results.filter(r => r.repaired).length,
      ok: results.filter(r => r.status === 'OK').length,
      failed: results.filter(r => r.status === 'REPAIR_FAILED').length,
      results
    });
  } catch (error) {
    console.error('[backfillSettlementData] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});