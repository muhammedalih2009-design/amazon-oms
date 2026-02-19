import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';

/**
 * P0 SECURITY: Verify workspace membership with strict server-side validation
 * Returns workspace_id if authorized, throws 403 if not
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id } = await req.json();

    if (!workspace_id) {
      return Response.json({ error: 'workspace_id required' }, { status: 400 });
    }

    // App owner can access all workspaces
    if (user.email.toLowerCase() === APP_OWNER_EMAIL.toLowerCase()) {
      // Log owner access
      await base44.asServiceRole.entities.AuditLog.create({
        workspace_id,
        user_id: user.id,
        user_email: user.email,
        action: 'workspace_access_granted',
        entity_type: 'workspace',
        entity_id: workspace_id,
        metadata: { reason: 'app_owner_access', ip_address: req.headers.get('x-forwarded-for') || 'unknown' }
      }).catch(() => {}); // Don't fail on logging error

      return Response.json({ 
        authorized: true, 
        workspace_id,
        role: 'owner',
        reason: 'app_owner'
      });
    }

    // STRICT CHECK: Verify membership exists
    const memberships = await base44.entities.Membership.filter({
      workspace_id,
      user_email: user.email
    });

    if (memberships.length === 0) {
      // LOG ACCESS DENIAL
      await base44.asServiceRole.entities.AuditLog.create({
        workspace_id,
        user_id: user.id,
        user_email: user.email,
        action: 'workspace_access_denied',
        entity_type: 'workspace',
        entity_id: workspace_id,
        metadata: { 
          reason: 'no_membership',
          ip_address: req.headers.get('x-forwarded-for') || 'unknown',
          route: req.headers.get('referer') || 'unknown'
        }
      }).catch(() => {}); // Don't fail on logging error

      return Response.json({ 
        error: 'Access denied: You are not a member of this workspace',
        authorized: false 
      }, { status: 403 });
    }

    const membership = memberships[0];

    return Response.json({ 
      authorized: true, 
      workspace_id,
      role: membership.role,
      permissions: membership.permissions,
      membership_id: membership.id
    });

  } catch (error) {
    console.error('Membership verification error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});