import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PLATFORM_ADMIN_EMAIL = 'muhammedalih.2009@gmail.com';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id, action, module_key, enabled } = await req.json();

    if (!workspace_id || !action) {
      return Response.json({ 
        ok: false, 
        error: 'workspace_id and action required' 
      }, { status: 400 });
    }

    // Check if user is platform admin or workspace owner/admin
    const isPlatformAdmin = user.email === PLATFORM_ADMIN_EMAIL;
    
    if (!isPlatformAdmin) {
      const memberships = await base44.asServiceRole.entities.Membership.filter({
        tenant_id: workspace_id,
        user_email: user.email
      });

      if (memberships.length === 0 || !['owner', 'admin'].includes(memberships[0].role)) {
        return Response.json({ 
          ok: false, 
          error: 'Workspace admin access required' 
        }, { status: 403 });
      }
    }

    console.log(`[Workspace Modules] ${user.email} performing ${action} on ${workspace_id}`);

    switch (action) {
      case 'list': {
        const modules = await base44.asServiceRole.entities.WorkspaceModule.filter({
          workspace_id
        });
        return Response.json({ ok: true, modules });
      }

      case 'update': {
        if (!module_key) {
          return Response.json({ ok: false, error: 'module_key required' }, { status: 400 });
        }

        const existing = await base44.asServiceRole.entities.WorkspaceModule.filter({
          workspace_id,
          module_key
        });

        if (existing.length > 0) {
          await base44.asServiceRole.entities.WorkspaceModule.update(existing[0].id, {
            enabled: enabled !== undefined ? enabled : true
          });
        } else {
          await base44.asServiceRole.entities.WorkspaceModule.create({
            workspace_id,
            module_key,
            enabled: enabled !== undefined ? enabled : true
          });
        }

        return Response.json({ ok: true, message: 'Module updated' });
      }

      case 'initialize': {
        // Initialize all modules as enabled
        const allModules = [
          'dashboard', 'stores', 'skus', 'orders', 'profitability',
          'purchase_requests', 'purchases', 'returns', 'suppliers',
          'tasks', 'team', 'stock_integrity', 'settlements'
        ];

        const existing = await base44.asServiceRole.entities.WorkspaceModule.filter({
          workspace_id
        });
        const existingKeys = new Set(existing.map(m => m.module_key));

        const toCreate = allModules
          .filter(key => !existingKeys.has(key))
          .map(key => ({
            workspace_id,
            module_key: key,
            enabled: true
          }));

        if (toCreate.length > 0) {
          await base44.asServiceRole.entities.WorkspaceModule.bulkCreate(toCreate);
        }

        return Response.json({ ok: true, initialized: toCreate.length });
      }

      default:
        return Response.json({ ok: false, error: 'Invalid action' }, { status: 400 });
    }

  } catch (error) {
    console.error('[Workspace Modules] Error:', error);
    return Response.json({
      ok: false,
      error: error.message || 'Operation failed'
    }, { status: 500 });
  }
});