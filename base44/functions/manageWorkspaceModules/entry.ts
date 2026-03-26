import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { guardWorkspaceAccess, requireWorkspaceId, isPlatformOwner } from './helpers/guardWorkspaceAccess.js';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const { action, module_key, enabled } = payload;

    // SECURITY: Require workspace_id
    const workspace_id = requireWorkspaceId(payload);

    if (!action) {
      return Response.json({ ok: false, error: 'action required' }, { status: 400 });
    }

    // SECURITY: Verify workspace access
    const membership = await guardWorkspaceAccess(base44, user, workspace_id);

    // Only platform owner or workspace admin can manage modules
    if (!isPlatformOwner(user) && !['owner', 'admin'].includes(membership.role)) {
      return Response.json({ 
        ok: false, 
        error: 'Workspace admin access required' 
      }, { status: 403 });
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
            enabled: enabled !== undefined ? enabled : true,
            actor_user_id: user.id
          });
        } else {
          await base44.asServiceRole.entities.WorkspaceModule.create({
            workspace_id,
            module_key,
            enabled: enabled !== undefined ? enabled : true,
            actor_user_id: user.id
          });
        }

        // Log audit
        await base44.asServiceRole.entities.AuditLog.create({
          workspace_id,
          actor_user_id: user.id,
          action: enabled ? 'module_enabled' : 'module_disabled',
          target_type: 'WorkspaceModule',
          meta: {
            module_key,
            enabled
          }
        });

        return Response.json({ ok: true, message: 'Module updated' });
      }

      case 'initialize': {
        // Initialize all modules as enabled
        const allModules = [
          'dashboard', 'stores', 'skus_products', 'orders', 'profitability',
          'purchase_requests', 'purchases', 'returns', 'suppliers',
          'tasks', 'team', 'settings'
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
            enabled: true,
            actor_user_id: user.id
          }));

        if (toCreate.length > 0) {
          await base44.asServiceRole.entities.WorkspaceModule.bulkCreate(toCreate);
        }

        // Log audit
        await base44.asServiceRole.entities.AuditLog.create({
          workspace_id,
          actor_user_id: user.id,
          action: 'module_change',
          target_type: 'WorkspaceModule',
          meta: {
            action: 'initialize',
            modules_created: toCreate.length
          }
        });

        return Response.json({ ok: true, initialized: toCreate.length });
      }
      
      case 'bulk_update': {
        const { modules_to_enable } = await req.json();
        if (!Array.isArray(modules_to_enable)) {
          return Response.json({ ok: false, error: 'modules_to_enable must be array' }, { status: 400 });
        }

        // Get all existing modules for this workspace
        const existing = await base44.asServiceRole.entities.WorkspaceModule.filter({
          workspace_id
        });
        
        const existingMap = new Map(existing.map(m => [m.module_key, m]));
        const allModules = [
          'dashboard', 'stores', 'skus_products', 'orders', 'profitability',
          'purchase_requests', 'purchases', 'returns', 'suppliers',
          'tasks', 'team', 'settings'
        ];

        // CRITICAL: Dashboard and Settings always enabled
        const alwaysEnabled = ['dashboard', 'settings'];
        const effectiveEnabled = [...new Set([...modules_to_enable, ...alwaysEnabled])];

        for (const moduleKey of allModules) {
          const shouldBeEnabled = effectiveEnabled.includes(moduleKey);
          const existingModule = existingMap.get(moduleKey);

          if (existingModule) {
            // Update existing
            if (existingModule.enabled !== shouldBeEnabled) {
              await base44.asServiceRole.entities.WorkspaceModule.update(existingModule.id, {
                enabled: shouldBeEnabled,
                actor_user_id: user.id
              });
            }
          } else {
            // Create new
            await base44.asServiceRole.entities.WorkspaceModule.create({
              workspace_id,
              module_key: moduleKey,
              enabled: shouldBeEnabled,
              actor_user_id: user.id
            });
          }
        }

        // Log audit
        await base44.asServiceRole.entities.AuditLog.create({
          workspace_id,
          actor_user_id: user.id,
          action: 'module_change',
          target_type: 'WorkspaceModule',
          meta: {
            action: 'bulk_update',
            enabled_count: modules_to_enable.length
          }
        });

        return Response.json({ ok: true, updated: allModules.length });
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