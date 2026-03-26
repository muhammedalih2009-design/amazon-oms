import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { token } = await req.json();

    if (!token) {
      return Response.json({ error: 'Missing invite token' }, { status: 400 });
    }

    // Get current user
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Must be logged in to accept invite' }, { status: 401 });
    }

    // Find invite by token
    const invites = await base44.asServiceRole.entities.WorkspaceInvite.filter({ token });
    
    if (!invites || invites.length === 0) {
      return Response.json({ error: 'Invalid invite token' }, { status: 404 });
    }

    const invite = invites[0];

    // Validate invite status
    if (invite.status !== 'pending') {
      return Response.json({ error: `Invite already ${invite.status}` }, { status: 400 });
    }

    // Check if expired
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      await base44.asServiceRole.entities.WorkspaceInvite.update(invite.id, {
        status: 'expired'
      });
      return Response.json({ error: 'Invite has expired' }, { status: 400 });
    }

    // Canonical email field: invited_email (with fallback to email for legacy invites)
    const inviteEmail = invite.invited_email || invite.email;
    
    if (!inviteEmail) {
      return Response.json({ 
        error: 'Invalid invite: missing email' 
      }, { status: 400 });
    }

    // Email must match
    if (user.email.toLowerCase() !== inviteEmail.toLowerCase()) {
      return Response.json({ 
        error: 'Email mismatch: Invite sent to different email address' 
      }, { status: 403 });
    }

    // Upsert PlatformUser
    const existingUsers = await base44.asServiceRole.entities.PlatformUser.filter({ 
      email: user.email 
    });

    let platformUser;
    if (existingUsers && existingUsers.length > 0) {
      platformUser = existingUsers[0];
    } else {
      platformUser = await base44.asServiceRole.entities.PlatformUser.create({
        email: user.email,
        name: user.full_name || user.email.split('@')[0],
        platform_role: 'user',
        status: 'active'
      });
    }

    // Check if already member (Membership is canonical)
    const existingMemberships = await base44.asServiceRole.entities.Membership.filter({
      tenant_id: invite.workspace_id,
      user_id: platformUser.id
    });

    if (existingMemberships && existingMemberships.length > 0) {
      // Already a member, just mark invite as accepted
      await base44.asServiceRole.entities.WorkspaceInvite.update(invite.id, {
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        accepted_by_user_id: platformUser.id
      });

      return Response.json({
        success: true,
        workspace_id: invite.workspace_id,
        already_member: true
      });
    }

    // CANONICAL: Create Membership (not WorkspaceMember)
    const defaultPermissions = {
      dashboard: { view: true, edit: invite.role === 'owner' || invite.role === 'admin' },
      tasks: { view: true, edit: true },
      skus: { view: true, edit: true },
      orders: { view: true, edit: true },
      purchases: { view: true, edit: true },
      returns: { view: true, edit: invite.role === 'owner' || invite.role === 'admin' },
      suppliers: { view: true, edit: invite.role === 'owner' || invite.role === 'admin' },
      settlement: { view: true, edit: invite.role === 'owner' || invite.role === 'admin' }
    };

    await base44.asServiceRole.entities.Membership.create({
      tenant_id: invite.workspace_id,
      user_id: platformUser.id,
      user_email: user.email,
      role: invite.role,
      permissions: defaultPermissions
    });

    // Mark invite as accepted (idempotent)
    await base44.asServiceRole.entities.WorkspaceInvite.update(invite.id, {
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      accepted_by_user_id: platformUser.id
    });

    // Log audit
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id: invite.workspace_id,
      actor_user_id: platformUser.id,
      action: 'membership_created_via_invite',
      target_type: 'Membership',
      target_id: null,
      meta: {
        email: user.email,
        role: invite.role,
        invite_id: invite.id
      }
    });

    return Response.json({
      success: true,
      workspace_id: invite.workspace_id
    });

  } catch (error) {
    console.error('Accept invite error:', error);
    return Response.json({ 
      error: error.message || 'Failed to accept invite' 
    }, { status: 500 });
  }
});