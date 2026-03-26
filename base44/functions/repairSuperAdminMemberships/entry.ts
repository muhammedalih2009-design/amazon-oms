import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';
const AUTO_WORKSPACE_PROVISIONING = false; // P0 SECURITY: HARD BLOCK

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Authenticate and verify app owner ONLY
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // P0 SECURITY: Verify auto-provisioning is disabled
    if (AUTO_WORKSPACE_PROVISIONING === true) {
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'repair_my_access_blocked_security',
        entity_type: 'System',
        user_email: user.email,
        metadata: {
          reason: 'AUTO_WORKSPACE_PROVISIONING must be false'
        }
      });
      return Response.json({ 
        error: 'Security violation: Auto-provisioning must be disabled' 
      }, { status: 403 });
    }

    // P0 FIX: OWNER-ONLY (never creates workspaces, only repairs owner's memberships)
    if (user.email.toLowerCase() !== APP_OWNER_EMAIL.toLowerCase()) {
      return Response.json({ 
        error: 'Forbidden: Only app owner can repair memberships' 
      }, { status: 403 });
    }

    // Get all NON-DELETED workspaces
    const allWorkspaces = await base44.asServiceRole.entities.Tenant.filter({});
    const workspaces = allWorkspaces.filter(w => !w.deleted_at);
    
    let created = 0;
    let skipped = 0;
    const errors = [];

    // P0 FIX: ONLY repair OWNER's memberships (never create workspaces)
    for (const workspace of workspaces) {
      try {
        // Check if owner already has membership
        const memberships = await base44.asServiceRole.entities.Membership.filter({
          tenant_id: workspace.id,
          user_id: user.id
        });

        if (memberships.length === 0) {
          // Create membership ONLY for owner
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
              settlement: { view: true, edit: true },
              suppliers: { view: true, edit: true }
            }
          });
          created++;
          
          // Audit log
          await base44.asServiceRole.entities.AuditLog.create({
            workspace_id: workspace.id,
            user_id: user.id,
            user_email: user.email,
            action: 'repair_my_access_membership_created',
            entity_type: 'Membership',
            metadata: {
              workspace_name: workspace.name,
              repaired_by: user.email
            }
          });
        } else {
          skipped++;
        }
      } catch (error) {
        errors.push({
          workspace_id: workspace.id,
          workspace_name: workspace.name,
          error: error.message
        });
      }
    }

    // P0 MONITORING: Log repair run
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id: null,
      user_id: user.id,
      user_email: user.email,
      action: 'repair_my_access_run',
      entity_type: 'System',
      metadata: {
        total_workspaces: workspaces.length,
        memberships_created: created,
        memberships_skipped: skipped,
        errors_count: errors.length
      }
    });

    return Response.json({
      success: true,
      total_workspaces: workspaces.length,
      memberships_created: created,
      memberships_skipped: skipped,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Repair memberships error:', error);
    return Response.json({ 
      error: error.message || 'Failed to repair memberships' 
    }, { status: 500 });
  }
});