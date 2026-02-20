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

    // Email must match
    if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
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

    // Check if already member
    const existingMembers = await base44.asServiceRole.entities.WorkspaceMember.filter({
      workspace_id: invite.workspace_id,
      user_id: platformUser.id
    });

    if (existingMembers && existingMembers.length > 0) {
      // Already a member, just mark invite as accepted
      await base44.asServiceRole.entities.WorkspaceInvite.update(invite.id, {
        status: 'accepted',
        accepted_at: new Date().toISOString()
      });

      return Response.json({
        success: true,
        workspace_id: invite.workspace_id,
        already_member: true
      });
    }

    // Create WorkspaceMember
    await base44.asServiceRole.entities.WorkspaceMember.create({
      workspace_id: invite.workspace_id,
      user_id: platformUser.id,
      user_email: user.email,
      role: invite.role,
      enabled_modules: invite.enabled_modules || {
        dashboard: true,
        stores: false,
        skus_products: false,
        orders: false,
        purchase_requests: false,
        purchases: false,
        suppliers: false,
        returns: false,
        profitability: false,
        tasks: false
      }
    });

    // Mark invite as accepted
    await base44.asServiceRole.entities.WorkspaceInvite.update(invite.id, {
      status: 'accepted',
      accepted_at: new Date().toISOString()
    });

    // Log audit
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id: invite.workspace_id,
      actor_user_id: platformUser.id,
      action: 'invite_accepted',
      target_type: 'WorkspaceInvite',
      target_id: invite.id,
      meta: {
        email: user.email,
        role: invite.role
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