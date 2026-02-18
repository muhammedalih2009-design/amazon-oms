import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PLATFORM_ADMIN_EMAIL = 'muhammedalih.2009@gmail.com';

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
  'Team': 'team'
};

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id, page_name } = await req.json();

    if (!workspace_id || !page_name) {
      return Response.json({ 
        ok: false, 
        error: 'workspace_id and page_name required' 
      }, { status: 400 });
    }

    // Platform admin bypass
    if (user.email === PLATFORM_ADMIN_EMAIL) {
      return Response.json({ ok: true, access: 'granted' });
    }

    // Get module key for page
    const moduleKey = PAGE_MODULE_MAP[page_name];
    if (!moduleKey) {
      // Unknown page, allow by default
      return Response.json({ ok: true, access: 'granted' });
    }

    // Check module status
    const modules = await base44.asServiceRole.entities.WorkspaceModule.filter({
      workspace_id,
      module_key: moduleKey
    });

    // If no modules configured, assume enabled
    if (modules.length === 0) {
      return Response.json({ ok: true, access: 'granted' });
    }

    const module = modules[0];
    if (!module.enabled) {
      return Response.json({ 
        ok: false, 
        access: 'denied',
        reason: 'Module not enabled for this workspace'
      }, { status: 403 });
    }

    return Response.json({ ok: true, access: 'granted' });

  } catch (error) {
    console.error('[Module Access Check] Error:', error);
    return Response.json({
      ok: false,
      error: error.message || 'Access check failed'
    }, { status: 500 });
  }
});