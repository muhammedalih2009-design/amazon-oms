import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const DEPLOYMENT_ID = 'v1-' + Date.now();
  const START_TIME = Date.now();

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const reqBody = await req.json();
    const { workspace_id: frontend_workspace_id } = reqBody;

    // STEP 1: Echo runtime context
    const runtimeContext = {
      deployment_id: DEPLOYMENT_ID,
      function_name: 'diagnosticEnvironmentContext',
      timestamp: new Date().toISOString(),
      user_id: user.id,
      user_email: user.email,
      frontend_workspace_id_received: frontend_workspace_id,
      environment: Deno.env.get('DENO_ENV') || 'production',
      app_id: Deno.env.get('BASE44_APP_ID') || 'unknown',
      deno_version: Deno.version.deno
    };

    console.log('[CONTEXT] Runtime environment:', runtimeContext);

    if (!frontend_workspace_id) {
      return Response.json({
        success: false,
        error: 'workspace_id required',
        runtime_context: runtimeContext
      }, { status: 400 });
    }

    // STEP 2: Get user's current tenant from session
    const memberships = await base44.asServiceRole.entities.Membership.filter({
      user_id: user.id
    });

    console.log(`[CONTEXT] User memberships: ${memberships.length}`);

    const userTenants = memberships.map(m => m.tenant_id);
    console.log(`[CONTEXT] User has access to tenants:`, userTenants);

    // STEP 3: Verify workspace_id exists and is accessible
    let tenantExists = false;
    let activeTenant = null;

    if (frontend_workspace_id) {
      try {
        activeTenant = await base44.asServiceRole.entities.Tenant.get(frontend_workspace_id);
        tenantExists = !!activeTenant;
        console.log(`[CONTEXT] Tenant lookup for ${frontend_workspace_id}:`, tenantExists ? 'FOUND' : 'NOT FOUND');
      } catch (error) {
        console.log(`[CONTEXT] Tenant.get(${frontend_workspace_id}) failed:`, error.message);
        tenantExists = false;
      }
    }

    // STEP 4: Count data using frontend workspace_id
    const [orders, imports, settlementRows] = await Promise.all([
      base44.asServiceRole.entities.Order.filter({ tenant_id: frontend_workspace_id }),
      base44.asServiceRole.entities.SettlementImport.filter({ tenant_id: frontend_workspace_id }),
      base44.asServiceRole.entities.SettlementRow.filter({ tenant_id: frontend_workspace_id, is_deleted: false })
    ]);

    console.log(`[DATA] Orders: ${orders.length} | Imports: ${imports.length} | SettlementRows: ${settlementRows.length}`);

    // STEP 5: Return comprehensive diagnostic
    const elapsed = Date.now() - START_TIME;

    return Response.json({
      success: true,
      runtime_context: runtimeContext,
      tenant_verification: {
        frontend_workspace_id,
        tenant_exists: tenantExists,
        tenant_name: activeTenant?.name || 'N/A',
        user_has_access: userTenants.includes(frontend_workspace_id)
      },
      data_counts: {
        orders_total: orders.length,
        orders_sample_ids: orders.slice(0, 5).map(o => o.id),
        settlement_imports_total: imports.length,
        imports_sample_ids: imports.slice(0, 5).map(i => i.id),
        settlement_rows_total: settlementRows.length,
        settlement_rows_sample_ids: settlementRows.slice(0, 5).map(r => r.id)
      },
      diagnostics: {
        workspace_consistency: frontend_workspace_id && tenantExists ? 'VALID' : 'MISMATCH',
        data_available: {
          orders: orders.length > 0,
          imports: imports.length > 0,
          settlement_rows: settlementRows.length > 0
        },
        env_signature: {
          app_id: runtimeContext.app_id,
          environment: runtimeContext.environment,
          deployment: DEPLOYMENT_ID
        }
      },
      duration_ms: elapsed
    });

  } catch (error) {
    console.error('[diagnosticEnvironmentContext] ERROR:', error);
    return Response.json({
      error: error.message,
      stack: error.stack,
      deployment_id: DEPLOYMENT_ID
    }, { status: 500 });
  }
});