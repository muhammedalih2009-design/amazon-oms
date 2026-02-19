import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // P0 SECURITY: ONLY owner can repair, and ONLY for themselves
    if (user.email.toLowerCase() !== APP_OWNER_EMAIL.toLowerCase()) {
      return Response.json({ error: 'Forbidden: Owner only' }, { status: 403 });
    }

    console.log(`[Repair Owner Access] Starting for ${user.email}`);

    // Get all non-deleted workspaces
    const allWorkspaces = await base44.asServiceRole.entities.Tenant.filter({
      deleted_at: { $exists: false }
    });

    const repaired = [];
    const skipped = [];

    for (const workspace of allWorkspaces) {
      // Check if owner membership exists
      const existing = await base44.asServiceRole.entities.Membership.filter({
        tenant_id: workspace.id,
        user_email: user.email.toLowerCase()
      });

      if (existing.length > 0) {
        skipped.push(workspace.id);
        continue;
      }

      // Create owner membership ONLY for this workspace
      await base44.asServiceRole.entities.Membership.create({
        tenant_id: workspace.id,
        user_id: user.id,
        user_email: user.email,
        role: 'owner',
        permissions: {
          dashboard: { view: true, edit: true },
          tasks: { view: true, edit: true },
          skus: { view: true, edit: true },
          orders: { view: true, edit: true },
          purchases: { view: true, edit: true },
          returns: { view: true, edit: true },
          suppliers: { view: true, edit: true }
        }
      });

      repaired.push(workspace.id);

      // Audit log
      await base44.asServiceRole.entities.AuditLog.create({
        workspace_id: workspace.id,
        user_id: user.id,
        user_email: user.email,
        action: 'owner_access_repaired',
        entity_type: 'Membership',
        after_data: JSON.stringify({ workspace_name: workspace.name }),
        metadata: { 
          repair_type: 'owner_self_repair',
          workspace_id: workspace.id
        }
      });
    }

    // Global audit log
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id: null,
      user_id: user.id,
      user_email: user.email,
      action: 'repair_access_completed',
      entity_type: 'System',
      metadata: {
        workspaces_repaired: repaired.length,
        workspaces_skipped: skipped.length,
        total_workspaces: allWorkspaces.length
      }
    });

    console.log(`[Repair Owner Access] Repaired ${repaired.length}, skipped ${skipped.length}`);

    return Response.json({
      ok: true,
      repaired: repaired.length,
      skipped: skipped.length,
      total_workspaces: allWorkspaces.length
    });
  } catch (error) {
    console.error('Error repairing owner access:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});