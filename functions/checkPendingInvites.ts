import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check for pending invites matching user's email
    const pendingInvites = await base44.asServiceRole.entities.WorkspaceInvite.filter({
      invited_email: user.email.toLowerCase(),
      status: 'pending'
    });

    const validInvites = [];

    for (const invite of pendingInvites) {
      // Check expiration
      if (new Date(invite.expires_at) < new Date()) {
        await base44.asServiceRole.entities.WorkspaceInvite.update(invite.id, {
          status: 'expired'
        });
        continue;
      }

      // Check if already a member
      const existingMember = await base44.entities.Membership.filter({
        tenant_id: invite.workspace_id,
        user_email: user.email
      });

      if (existingMember.length === 0) {
        validInvites.push(invite);
      } else {
        // Already member, mark as accepted
        await base44.asServiceRole.entities.WorkspaceInvite.update(invite.id, {
          status: 'accepted'
        });
      }
    }

    return Response.json({
      ok: true,
      invites: validInvites
    });
  } catch (error) {
    console.error('Error checking pending invites:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});