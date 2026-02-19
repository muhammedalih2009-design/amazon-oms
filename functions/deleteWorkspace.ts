import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // P0 SECURITY: Only owner can delete workspaces
    if (user.email.toLowerCase() !== APP_OWNER_EMAIL.toLowerCase()) {
      return Response.json({ error: 'Forbidden: Owner only' }, { status: 403 });
    }

    const { workspace_id } = await req.json();

    if (!workspace_id) {
      return Response.json({ error: 'workspace_id required' }, { status: 400 });
    }

    // Get workspace
    const workspaces = await base44.asServiceRole.entities.Tenant.filter({ id: workspace_id });
    if (workspaces.length === 0) {
      return Response.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const workspace = workspaces[0];

    // Soft delete workspace
    await base44.asServiceRole.entities.Tenant.update(workspace_id, {
      deleted_at: new Date().toISOString(),
      deleted_by: user.email
    });

    // Delete all workspace memberships
    const memberships = await base44.asServiceRole.entities.Membership.filter({ tenant_id: workspace_id });
    for (const membership of memberships) {
      await base44.asServiceRole.entities.Membership.delete(membership.id);
    }

    // Audit log
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id: workspace_id,
      user_id: user.id,
      user_email: user.email,
      action: 'workspace_deleted',
      entity_type: 'Tenant',
      entity_id: workspace_id,
      before_data: JSON.stringify({ name: workspace.name, slug: workspace.slug }),
      metadata: { 
        memberships_deleted: memberships.length,
        soft_delete: true
      }
    });

    return Response.json({
      ok: true,
      message: 'Workspace deleted',
      memberships_deleted: memberships.length
    });
  } catch (error) {
    console.error('Error deleting workspace:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});