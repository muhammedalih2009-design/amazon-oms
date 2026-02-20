import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { guardWorkspaceAccess, requireWorkspaceId } from './helpers/guardWorkspaceAccess.js';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const { workspace_id, email, role } = payload;

    if (!email || !role) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // SECURITY: Require and validate workspace_id
    const validatedWorkspaceId = requireWorkspaceId(payload);

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return Response.json({ error: 'Invalid email format' }, { status: 400 });
    }

    // SECURITY: Verify user has access and is admin/owner
    const membership = await guardWorkspaceAccess(base44, user, validatedWorkspaceId);
    
    if (!['owner', 'admin'].includes(membership.role)) {
      return Response.json({ error: 'Forbidden: Only workspace owner/admin can invite' }, { status: 403 });
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
      // Check for duplicate pending invite
      const existingInvites = await base44.asServiceRole.entities.WorkspaceInvite.filter({
        workspace_id,
        invited_email: normalizedEmail,
        status: 'pending'
      });

      let token;
      if (existingInvites.length > 0) {
        // Reuse existing invite token
        token = existingInvites[0].token;
      } else {
        // Create new invite
        token = crypto.randomUUID();
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
      }

      // Return token only, frontend builds link with correct domain
      return Response.json({
        ok: true,
        mode: 'invite_created',
        token,
        message: `Invite created for ${normalizedEmail}`
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