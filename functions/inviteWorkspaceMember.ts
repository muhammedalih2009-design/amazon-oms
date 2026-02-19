import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id, email, role } = await req.json();

    if (!workspace_id || !email || !role) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return Response.json({ error: 'Invalid email format' }, { status: 400 });
    }

    // Check permission: platform admin OR workspace owner/admin
    const isPlatformAdmin = user.email === 'admin@amazonoms.com' || user.role === 'admin';
    
    if (!isPlatformAdmin) {
      const membership = await base44.entities.Membership.filter({
        tenant_id: workspace_id,
        user_email: user.email
      });

      if (membership.length === 0 || !['owner', 'admin'].includes(membership[0].role)) {
        return Response.json({ error: 'Forbidden: Only workspace owner/admin can invite' }, { status: 403 });
      }
    }

    // Check if already a member
    const existingMember = await base44.entities.Membership.filter({
      tenant_id: workspace_id,
      user_email: normalizedEmail
    });

    if (existingMember.length > 0) {
      return Response.json({ error: 'User is already a member' }, { status: 400 });
    }

    // Check if pending invite exists
    const existingInvite = await base44.entities.WorkspaceInvite.filter({
      workspace_id,
      invited_email: normalizedEmail,
      status: 'pending'
    });

    if (existingInvite.length > 0) {
      return Response.json({ error: 'Pending invite already exists' }, { status: 400 });
    }

    // Check if user exists in system
    const existingUsers = await base44.asServiceRole.entities.User.filter({
      email: normalizedEmail
    });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    if (existingUsers.length > 0) {
      // User exists - add directly as member
      const existingUser = existingUsers[0];
      
      await base44.asServiceRole.entities.Membership.create({
        tenant_id: workspace_id,
        user_id: existingUser.id,
        user_email: normalizedEmail,
        role,
        permissions: getDefaultPermissions(role)
      });

      // Audit log
      await base44.asServiceRole.entities.AuditLog.create({
        workspace_id,
        user_id: user.id,
        user_email: user.email,
        action: 'create',
        entity_type: 'membership',
        metadata: {
          added_user: normalizedEmail,
          role
        }
      });

      return Response.json({
        ok: true,
        mode: 'member_added',
        message: `${normalizedEmail} added as member`
      });
    } else {
      // User doesn't exist - create invite
      const token = crypto.randomUUID();

      await base44.asServiceRole.entities.WorkspaceInvite.create({
        workspace_id,
        invited_email: normalizedEmail,
        role,
        token,
        status: 'pending',
        invited_by_user_id: user.id,
        invited_by_email: user.email,
        expires_at: expiresAt.toISOString()
      });

      // Get workspace details for email
      const workspace = await base44.asServiceRole.entities.Tenant.filter({ id: workspace_id });
      const workspaceName = workspace.length > 0 ? workspace[0].name : 'Workspace';

      // Generate in-app invite link (NEVER use function URL)
      const reqUrl = new URL(req.url);
      const appOrigin = reqUrl.hostname.includes('deno.dev') 
        ? 'https://amazonoms.base44.app'
        : reqUrl.origin;
      const inviteLink = `${appOrigin}/AcceptInvite?token=${token}`;

      // Send invitation email
      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: normalizedEmail,
          subject: `Workspace Invitation: ${workspaceName}`,
          body: `
            <h2>You've been invited to ${workspaceName}</h2>
            <p><strong>${user.full_name || user.email}</strong> has invited you to join the workspace <strong>${workspaceName}</strong> as a <strong>${role}</strong>.</p>
            <p>Click the link below to accept your invitation:</p>
            <p><a href="${inviteLink}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Accept Invitation</a></p>
            <p>Or copy this link: ${inviteLink}</p>
            <p>This invitation expires on ${expiresAt.toLocaleDateString()}.</p>
          `
        });
      } catch (emailError) {
        console.error('Failed to send invite email:', emailError);
        // Continue even if email fails
      }

      // Audit log
      await base44.asServiceRole.entities.AuditLog.create({
        workspace_id,
        user_id: user.id,
        user_email: user.email,
        action: 'create',
        entity_type: 'invite',
        metadata: {
          invited_email: normalizedEmail,
          role
        }
      });

      return Response.json({
        ok: true,
        mode: 'invite_created',
        token,
        invite_link: inviteLink,
        message: `Invite sent to ${normalizedEmail}`
      });
    }
  } catch (error) {
    console.error('Error inviting member:', error);
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