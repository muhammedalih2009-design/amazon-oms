import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const currentUser = await base44.auth.me();

    if (!currentUser) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id, email, role } = await req.json();

    // Validate inputs
    if (!workspace_id || !email || !role) {
      return Response.json({ 
        error: 'Missing required fields: workspace_id, email, role' 
      }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const normalizedEmail = email.toLowerCase().trim();
    
    if (!emailRegex.test(normalizedEmail)) {
      return Response.json({ error: 'Invalid email format' }, { status: 400 });
    }

    if (!['owner', 'admin', 'member', 'viewer'].includes(role)) {
      return Response.json({ error: 'Invalid role' }, { status: 400 });
    }

    // Check if current user is admin/owner of this workspace
    const memberships = await base44.entities.Membership.filter({
      tenant_id: workspace_id,
      user_email: currentUser.email
    });

    const currentMembership = memberships[0];
    if (!currentMembership || !['owner', 'admin'].includes(currentMembership.role)) {
      return Response.json({ 
        error: 'Unauthorized: Only workspace owners/admins can add members' 
      }, { status: 403 });
    }

    // Check if user already exists in the app
    const existingUsers = await base44.asServiceRole.entities.User.filter({ 
      email: normalizedEmail 
    });

    if (existingUsers.length > 0) {
      // User exists - add as member
      const targetUser = existingUsers[0];

      // Check if already a member
      const existingMemberships = await base44.entities.Membership.filter({
        tenant_id: workspace_id,
        user_email: normalizedEmail
      });

      if (existingMemberships.length > 0) {
        return Response.json({ 
          error: 'User is already a member of this workspace' 
        }, { status: 400 });
      }

      // Create membership
      await base44.asServiceRole.entities.Membership.create({
        tenant_id: workspace_id,
        user_id: targetUser.id,
        user_email: targetUser.email,
        role: role,
        permissions: {
          dashboard: { view: true, edit: role !== 'viewer' },
          tasks: { view: true, edit: role !== 'viewer' },
          skus: { view: true, edit: role !== 'viewer' },
          orders: { view: true, edit: role !== 'viewer' },
          purchases: { view: true, edit: role !== 'viewer' },
          returns: { view: true, edit: role !== 'viewer' },
          suppliers: { view: true, edit: role !== 'viewer' }
        }
      });

      return Response.json({ 
        ok: true,
        mode: 'member_added',
        user_email: normalizedEmail
      });

    } else {
      // User does NOT exist - create invite
      let inviteToken;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      // Check for duplicate pending invite
      const existingInvites = await base44.asServiceRole.entities.WorkspaceInvite.filter({
        workspace_id: workspace_id,
        invited_email: normalizedEmail,
        status: 'pending'
      });

      if (existingInvites.length > 0) {
        // Reuse existing invite token
        inviteToken = existingInvites[0].token;
      } else {
        // Create new invite
        inviteToken = crypto.randomUUID();
        await base44.asServiceRole.entities.WorkspaceInvite.create({
          workspace_id: workspace_id,
          invited_email: normalizedEmail,
          role: role,
          token: inviteToken,
          status: 'pending',
          invited_by: currentUser.email,
          expires_at: expiresAt.toISOString()
        });
      }

      return Response.json({ 
        ok: true,
        mode: 'invite_created',
        token: inviteToken,
        invited_email: normalizedEmail
      });
    }

  } catch (error) {
    console.error('Error adding member:', error);
    return Response.json({ 
      error: error.message || 'Failed to add member' 
    }, { status: 500 });
  }
});