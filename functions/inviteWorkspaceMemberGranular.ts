import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PLATFORM_ADMIN_EMAIL = 'muhammedalih.2009@gmail.com';
const APP_PUBLIC_BASE_URL = "https://amazon-oms-4b169a10.base44.app";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id, email, role, permissions } = await req.json();

    if (!workspace_id || !email || !role || !permissions) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return Response.json({ error: 'Invalid email format' }, { status: 400 });
    }

    // SECURITY: Check workspace access and permission to add members
    const memberships = await base44.entities.Membership.filter({
      tenant_id: workspace_id,
      user_email: user.email.toLowerCase()
    });

    if (memberships.length === 0) {
      return Response.json({ error: 'No access to this workspace' }, { status: 403 });
    }

    const membership = memberships[0];
    const isPlatformAdmin = user.email.toLowerCase() === PLATFORM_ADMIN_EMAIL.toLowerCase();

    // PERMISSION CHECK: Must have can_add_members permission OR be owner
    if (membership.role !== 'owner' && !isPlatformAdmin) {
      const canAddMembers = membership.permissions?.member_mgmt?.can_add_members;
      if (!canAddMembers) {
        return Response.json({ 
          error: 'Forbidden: You do not have permission to add members' 
        }, { status: 403 });
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

    // VALIDATION: Enforce view=true when edit=true
    const validatedPermissions = { ...permissions };
    Object.keys(validatedPermissions).forEach(key => {
      if (key !== 'member_mgmt' && validatedPermissions[key].edit === true) {
        validatedPermissions[key].view = true;
      }
    });

    // Check if user exists in system
    const existingUsers = await base44.asServiceRole.entities.User.filter({
      email: normalizedEmail
    });

    if (existingUsers.length > 0) {
      // User exists - add directly as member
      const existingUser = existingUsers[0];
      
      await base44.asServiceRole.entities.Membership.create({
        tenant_id: workspace_id,
        user_id: existingUser.id,
        user_email: normalizedEmail,
        role,
        permissions: validatedPermissions
      });

      // Audit log
      await base44.asServiceRole.entities.AuditLog.create({
        workspace_id,
        user_id: user.id,
        user_email: user.email,
        action: 'add_member',
        entity_type: 'Membership',
        metadata: {
          added_user: normalizedEmail,
          role,
          has_permissions: true
        }
      }).catch(() => {});

      return Response.json({
        success: true,
        mode: 'member_added',
        message: `${normalizedEmail} added as member`
      });
    } else {
      // User doesn't exist - create invite
      const token = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await base44.asServiceRole.entities.WorkspaceInvite.create({
        workspace_id,
        invited_email: normalizedEmail,
        role,
        permissions: validatedPermissions,
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
        action: 'create_invite',
        entity_type: 'WorkspaceInvite',
        metadata: {
          invited_email: normalizedEmail,
          role,
          has_permissions: true
        }
      }).catch(() => {});

      const inviteLink = `${APP_PUBLIC_BASE_URL}/AcceptInvite?token=${token}`;

      return Response.json({
        success: true,
        mode: 'invite_created',
        token,
        invite_link: inviteLink,
        message: `Invite created for ${normalizedEmail}`
      });
    }
  } catch (error) {
    console.error('Error inviting member:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});