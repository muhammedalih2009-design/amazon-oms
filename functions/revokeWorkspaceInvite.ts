import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { invite_id } = await req.json();

    if (!invite_id) {
      return Response.json({ error: 'Missing invite_id' }, { status: 400 });
    }

    // Get invite
    const invites = await base44.entities.WorkspaceInvite.filter({ id: invite_id });
    if (invites.length === 0) {
      return Response.json({ error: 'Invite not found' }, { status: 404 });
    }

    const invite = invites[0];

    // Check permission
    const isPlatformAdmin = user.email === 'admin@amazonoms.com' || user.role === 'admin';
    
    if (!isPlatformAdmin) {
      const membership = await base44.entities.Membership.filter({
        tenant_id: invite.workspace_id,
        user_email: user.email
      });

      if (membership.length === 0 || !['owner', 'admin'].includes(membership[0].role)) {
        return Response.json({ error: 'Forbidden: Only workspace owner/admin can revoke invites' }, { status: 403 });
      }
    }

    // Update invite status
    await base44.asServiceRole.entities.WorkspaceInvite.update(invite_id, {
      status: 'revoked'
    });

    // Audit log
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id: invite.workspace_id,
      user_id: user.id,
      user_email: user.email,
      action: 'delete',
      entity_type: 'invite',
      entity_id: invite_id,
      metadata: {
        invited_email: invite.invited_email,
        role: invite.role
      }
    });

    return Response.json({
      ok: true,
      message: 'Invite revoked'
    });
  } catch (error) {
    console.error('Error revoking invite:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});