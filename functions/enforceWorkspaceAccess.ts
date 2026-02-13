import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Workspace Access Enforcement
 * 
 * Validates that a user can access a specific workspace
 * Returns workspace data if allowed, error if blocked
 * 
 * Use this in other backend functions to enforce workspace isolation
 */

Deno.serve(async (req) => {
  try {
    const db = createClientFromRequest(req);
    const user = await db.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id } = await req.json();

    if (!workspace_id) {
      return Response.json({ error: 'workspace_id required' }, { status: 400 });
    }

    // Check if user is super admin
    const isSuperAdmin = user.role === 'admin' || user.email === 'admin@amazonoms.com';

    // Super admin can access any workspace
    if (isSuperAdmin) {
      const workspaces = await db.entities.Tenant.filter({ id: workspace_id });
      if (workspaces.length === 0) {
        return Response.json({
          ok: false,
          error: 'Workspace not found'
        }, { status: 404 });
      }

      const workspace = workspaces[0];
      const subscription = await db.entities.Subscription.filter({ tenant_id: workspace_id });

      return Response.json({
        ok: true,
        workspace,
        subscription: subscription[0] || null,
        access_level: 'super_admin',
        can_write: true
      });
    }

    // For regular users, check membership
    const memberships = await db.entities.Membership.filter({
      tenant_id: workspace_id,
      user_id: user.id
    });

    if (memberships.length === 0) {
      return Response.json({
        ok: false,
        error: 'Access denied: You are not a member of this workspace'
      }, { status: 403 });
    }

    const membership = memberships[0];
    const workspace = await db.entities.Tenant.filter({ id: workspace_id });
    const subscription = await db.entities.Subscription.filter({ tenant_id: workspace_id });

    if (workspace.length === 0) {
      return Response.json({
        ok: false,
        error: 'Workspace not found'
      }, { status: 404 });
    }

    const sub = subscription[0];

    // Check workspace status
    if (sub && (sub.status === 'canceled' || sub.status === 'inactive')) {
      return Response.json({
        ok: false,
        error: `Workspace is ${sub.status}. Access denied.`,
        workspace_status: sub.status
      }, { status: 403 });
    }

    // Determine write access based on role
    const canWrite = ['owner', 'admin'].includes(membership.role);

    return Response.json({
      ok: true,
      workspace: workspace[0],
      subscription: sub || null,
      membership,
      access_level: membership.role,
      can_write: canWrite
    });

  } catch (error) {
    console.error('Workspace access enforcement error:', error);
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});