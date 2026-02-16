import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { workspace_id, import_id } = body;

    if (!workspace_id || !import_id) {
      return Response.json({ error: 'Missing workspace_id or import_id' }, { status: 400 });
    }

    // Verify access
    const membership = await base44.asServiceRole.entities.Membership.filter({
      tenant_id: workspace_id,
      user_id: user.id
    });

    if (membership.length === 0) {
      return Response.json({ error: 'No access to workspace' }, { status: 403 });
    }

    // Get import
    const importJob = await base44.asServiceRole.entities.SettlementImport.get(import_id);
    if (!importJob || importJob.tenant_id !== workspace_id) {
      return Response.json({ error: 'Import not found' }, { status: 404 });
    }

    // Count actual rows
    const actualRows = await base44.asServiceRole.entities.SettlementRow.filter({
      settlement_import_id: import_id
    });

    // Parse expected count
    let expectedRows = 0;
    try {
      const parsed = JSON.parse(importJob.parsed_rows_json || '[]');
      expectedRows = parsed.length;
    } catch (err) {
      return Response.json({ error: 'Failed to parse import data' }, { status: 500 });
    }

    const status = actualRows.length === expectedRows ? 'OK' : 
                  actualRows.length === 0 ? 'MISSING_ALL' :
                  actualRows.length < expectedRows * 0.95 ? 'MISSING_MANY' :
                  'MINOR_MISMATCH';

    return Response.json({
      import_id,
      status,
      expected_rows: expectedRows,
      actual_rows: actualRows.length,
      missing_rows: expectedRows - actualRows.length,
      needs_rebuild: status !== 'OK'
    });
  } catch (error) {
    console.error('[checkSettlementIntegrity] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});