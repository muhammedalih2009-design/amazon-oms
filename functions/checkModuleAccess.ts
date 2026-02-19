import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Server-side module access enforcement
 * Call this at the start of any backend function that needs workspace-specific module access
 */

const PAGE_MODULE_MAP = {
  'Dashboard': 'dashboard',
  'Stores': 'stores',
  'SKUs': 'skus_products',
  'Orders': 'orders',
  'Profitability': 'profitability',
  'PurchaseRequests': 'purchase_requests',
  'Purchases': 'purchases',
  'Returns': 'returns',
  'Suppliers': 'suppliers',
  'Tasks': 'tasks',
  'Team': 'team',
  'Settings': 'settings',
  'BackupData': 'stores'
};

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ 
        ok: false, 
        error: 'Unauthorized' 
      }, { status: 401 });
    }

    const { workspace_id, module_key, page_name } = await req.json();

    if (!workspace_id) {
      return Response.json({ 
        ok: false, 
        error: 'workspace_id required' 
      }, { status: 400 });
    }

    // Determine module key from page name if provided
    let checkModuleKey = module_key;
    if (!checkModuleKey && page_name) {
      checkModuleKey = PAGE_MODULE_MAP[page_name];
    }

    if (!checkModuleKey) {
      return Response.json({ 
        ok: false, 
        error: 'module_key or page_name required' 
      }, { status: 400 });
    }

    // Check workspace membership
    const memberships = await base44.asServiceRole.entities.Membership.filter({
      tenant_id: workspace_id,
      user_email: user.email
    });

    if (memberships.length === 0) {
      return Response.json({ 
        ok: false, 
        error: 'Not a member of this workspace',
        access_denied: true
      }, { status: 403 });
    }

    // Check if module is enabled for workspace
    const modules = await base44.asServiceRole.entities.WorkspaceModule.filter({
      workspace_id,
      module_key: checkModuleKey
    });

    if (modules.length === 0) {
      // No module config = allow (legacy workspaces)
      return Response.json({ 
        ok: true, 
        access_granted: true,
        reason: 'legacy_workspace' 
      });
    }

    const module = modules[0];
    
    if (!module.enabled) {
      return Response.json({ 
        ok: false, 
        error: `Module '${checkModuleKey}' is not enabled for this workspace`,
        access_denied: true,
        module_key: checkModuleKey
      }, { status: 403 });
    }

    return Response.json({ 
      ok: true, 
      access_granted: true,
      module_key: checkModuleKey,
      workspace_id
    });

  } catch (error) {
    console.error('[Module Access Check] Error:', error);
    return Response.json({
      ok: false,
      error: error.message || 'Access check failed'
    }, { status: 500 });
  }
});