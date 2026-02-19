import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { token } = await req.json();

    if (!token) {
      return Response.json({ error: 'Missing token' }, { status: 400 });
    }

    // Find invite by token
    const invites = await base44.asServiceRole.entities.WorkspaceInvite.filter({
      token,
      status: 'pending'
    });

    if (invites.length === 0) {
      return Response.json({ error: 'Invalid or expired invite' }, { status: 404 });
    }

    const invite = invites[0];

    // Check expiration
    if (new Date(invite.expires_at) < new Date()) {
      await base44.asServiceRole.entities.WorkspaceInvite.update(invite.id, {
        status: 'expired'
      });
      return Response.json({ error: 'Invite has expired' }, { status: 400 });
    }

    // Verify email matches
    if (user.email.toLowerCase() !== invite.invited_email.toLowerCase()) {
      return Response.json({ 
        error: 'This invite is for a different email address',
        invited_email: invite.invited_email
      }, { status: 403 });
    }

    // Check if already a member
    const existingMember = await base44.entities.Membership.filter({
      tenant_id: invite.workspace_id,
      user_email: user.email
    });

    if (existingMember.length > 0) {
      // Already member, just mark invite as accepted
      await base44.asServiceRole.entities.WorkspaceInvite.update(invite.id, {
        status: 'accepted'
      });
      return Response.json({
        ok: true,
        message: 'Already a member',
        workspace_id: invite.workspace_id
      });
    }

    // Create membership
    await base44.asServiceRole.entities.Membership.create({
      tenant_id: invite.workspace_id,
      user_id: user.id,
      user_email: user.email,
      role: invite.role,
      permissions: getDefaultPermissions(invite.role)
    });

    // Update invite status
    await base44.asServiceRole.entities.WorkspaceInvite.update(invite.id, {
      status: 'accepted',
      accepted_at: new Date().toISOString()
    });

    // Get workspace details for redirect
    const workspace = await base44.asServiceRole.entities.Tenant.filter({ id: invite.workspace_id });
    const workspaceSlug = workspace.length > 0 ? workspace[0].slug : null;

    // Audit log
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id: invite.workspace_id,
      user_id: user.id,
      user_email: user.email,
      action: 'create',
      entity_type: 'Membership',
      after_data: JSON.stringify({
        user_email: user.email,
        role: invite.role
      }),
      metadata: {
        accepted_invite: true,
        invited_by: invite.invited_by
      }
    });

    return Response.json({
      ok: true,
      message: 'Invite accepted',
      workspace_id: invite.workspace_id,
      workspace_slug: workspaceSlug
    });
  } catch (error) {
    console.error('Error accepting invite:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function getDefaultPermissions(role) {
  if (role === 'owner' || role === 'admin') {
    return {
      dashboard: { view: true, edit: true },
      tasks: { view: true, edit: true },
      skus: { view: true, edit: true },
      orders: { view: true, edit: true },
      purchases: { view: true, edit: true },
      returns: { view: true, edit: true },
      suppliers: { view: true, edit: true }
    };
  }
  
  if (role === 'member') {
    return {
      dashboard: { view: true, edit: false },
      tasks: { view: true, edit: true },
      skus: { view: true, edit: true },
      orders: { view: true, edit: true },
      purchases: { view: true, edit: true },
      returns: { view: true, edit: false },
      suppliers: { view: true, edit: false }
    };
  }

  // viewer
  return {
    dashboard: { view: true, edit: false },
    tasks: { view: true, edit: false },
    skus: { view: true, edit: false },
    orders: { view: true, edit: false },
    purchases: { view: true, edit: false },
    returns: { view: true, edit: false },
    suppliers: { view: true, edit: false }
  };
}