import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';
const AUTO_WORKSPACE_PROVISIONING = false; // P0 SECURITY: HARD BLOCK

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const currentUser = await base44.auth.me();

    // P0 SECURITY: Verify auto-provisioning is disabled
    if (AUTO_WORKSPACE_PROVISIONING === true) {
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'workspace_deletion_blocked_security',
        entity_type: 'System',
        user_email: currentUser.email,
        metadata: {
          reason: 'AUTO_WORKSPACE_PROVISIONING must be false'
        }
      });
      return Response.json({ 
        error: 'Security violation: Auto-provisioning must be disabled' 
      }, { status: 403 });
    }

    // P0 FIX: OWNER-ONLY workspace deletion
    if (currentUser.email.toLowerCase() !== APP_OWNER_EMAIL.toLowerCase()) {
      return Response.json({ 
        error: 'Forbidden: Only app owner can delete workspaces' 
      }, { status: 403 });
    }

    const { workspace_id } = await req.json();

    if (!workspace_id) {
      return Response.json({ error: 'workspace_id required' }, { status: 400 });
    }

    // Get workspace
    const workspace = await base44.asServiceRole.entities.Tenant.get(workspace_id);
    if (!workspace) {
      return Response.json({ error: 'Workspace not found' }, { status: 404 });
    }

    // Check if already deleted
    if (workspace.deleted_at) {
      return Response.json({ error: 'Workspace already deleted' }, { status: 400 });
    }

    // P0 FIX: Proper soft delete
    // 1. Mark workspace as deleted
    await base44.asServiceRole.entities.Tenant.update(workspace_id, {
      deleted_at: new Date().toISOString(),
      deleted_by: currentUser.email
    });

    // 2. Delete all memberships for this workspace
    const memberships = await base44.asServiceRole.entities.Membership.filter({
      tenant_id: workspace_id
    });

    for (const membership of memberships) {
      await base44.asServiceRole.entities.Membership.delete(membership.id);
    }

    // P0 MONITORING: Log workspace deletion with auto-provisioning flag
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id: workspace_id,
      user_id: currentUser.id,
      user_email: currentUser.email,
      action: 'workspace_deleted',
      entity_type: 'Tenant',
      entity_id: workspace_id,
      before_data: JSON.stringify({
        name: workspace.name,
        slug: workspace.slug
      }),
      metadata: {
        workspace_name: workspace.name,
        deleted_by: currentUser.email,
        memberships_removed: memberships.length,
        auto_provisioning_disabled: AUTO_WORKSPACE_PROVISIONING === false
      }
    });

    return Response.json({
      success: true,
      message: 'Workspace deleted successfully',
      workspace_name: workspace.name,
      memberships_removed: memberships.length
    });

  } catch (error) {
    console.error('Delete workspace error:', error);
    return Response.json({ 
      error: error.message || 'Failed to delete workspace' 
    }, { status: 500 });
  }
});