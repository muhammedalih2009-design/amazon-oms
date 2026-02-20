import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PLATFORM_ADMIN_EMAIL = 'muhammedalih.2009@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // SECURITY: Platform admin only
    if (user.email.toLowerCase() !== PLATFORM_ADMIN_EMAIL.toLowerCase()) {
      return Response.json({ error: 'Forbidden: Platform admin access required' }, { status: 403 });
    }

    const { email, workspace_id, role, permissions } = await req.json();

    if (!email || !workspace_id || !role) {
      return Response.json({ 
        error: 'Missing required fields: email, workspace_id, role' 
      }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Verify workspace exists
    const workspace = await base44.asServiceRole.entities.Tenant.get(workspace_id);
    if (!workspace) {
      return Response.json({ error: 'Workspace not found' }, { status: 404 });
    }

    // Check if membership already exists
    const existing = await base44.asServiceRole.entities.Membership.filter({
      tenant_id: workspace_id,
      user_email: normalizedEmail
    });

    if (existing.length > 0) {
      // Update existing membership
      await base44.asServiceRole.entities.Membership.update(existing[0].id, {
        role,
        permissions: permissions || existing[0].permissions
      });

      return Response.json({
        success: true,
        message: 'Membership updated',
        membership_id: existing[0].id
      });
    }

    // Create new membership
    const membership = await base44.asServiceRole.entities.Membership.create({
      tenant_id: workspace_id,
      user_email: normalizedEmail,
      user_id: null, // Will be populated when user logs in
      role: role || 'staff',
      permissions: permissions || {
        dashboard: { view: true, edit: false }
      }
    });

    return Response.json({
      success: true,
      message: 'User assigned to workspace',
      membership_id: membership.id
    });

  } catch (error) {
    console.error('Assign user to workspace error:', error);
    return Response.json({ 
      error: error.message || 'Failed to assign user' 
    }, { status: 500 });
  }
});