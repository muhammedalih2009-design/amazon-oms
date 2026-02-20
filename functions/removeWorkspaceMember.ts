import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PLATFORM_ADMIN_EMAIL = 'muhammedalih.2009@gmail.com';

// Role hierarchy for permission checks
const ROLE_LEVELS = {
  owner: 100,
  admin: 70,
  manager: 50,
  staff: 10
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id, target_email } = await req.json();

    if (!workspace_id || !target_email) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const normalizedTargetEmail = target_email.toLowerCase().trim();
    const isPlatformAdmin = user.email.toLowerCase() === PLATFORM_ADMIN_EMAIL.toLowerCase();

    // SECURITY: Check actor's workspace access
    const actorMemberships = await base44.entities.Membership.filter({
      tenant_id: workspace_id,
      user_email: user.email.toLowerCase()
    });

    if (actorMemberships.length === 0) {
      return Response.json({ error: 'No access to this workspace' }, { status: 403 });
    }

    const actorMembership = actorMemberships[0];

    // PERMISSION CHECK: Must have can_remove_members permission OR be owner OR be platform admin
    if (actorMembership.role !== 'owner' && !isPlatformAdmin) {
      const canRemoveMembers = actorMembership.permissions?.member_mgmt?.can_remove_members;
      if (!canRemoveMembers) {
        return Response.json({ 
          error: 'Forbidden: You do not have permission to remove members' 
        }, { status: 403 });
      }
    }

    // Find target member
    const targetMemberships = await base44.entities.Membership.filter({
      tenant_id: workspace_id,
      user_email: normalizedTargetEmail
    });

    if (targetMemberships.length === 0) {
      return Response.json({ error: 'User is not a member of this workspace' }, { status: 404 });
    }

    const targetMembership = targetMemberships[0];

    // SAFETY RULE 1: Cannot remove workspace owner (except platform admin)
    if (targetMembership.role === 'owner' && !isPlatformAdmin) {
      return Response.json({ 
        error: 'Forbidden: Workspace owner can only be removed by platform admin' 
      }, { status: 403 });
    }

    // SAFETY RULE 2: Cannot remove member with same or higher role level
    if (!isPlatformAdmin) {
      const actorLevel = ROLE_LEVELS[actorMembership.role] || 0;
      const targetLevel = ROLE_LEVELS[targetMembership.role] || 0;

      if (targetLevel >= actorLevel) {
        return Response.json({ 
          error: 'Forbidden: Cannot remove member with equal or higher role' 
        }, { status: 403 });
      }
    }

    // SAFETY RULE 3: Cannot remove self (except platform admin)
    if (user.email.toLowerCase() === normalizedTargetEmail && !isPlatformAdmin) {
      return Response.json({ 
        error: 'Cannot remove yourself from the workspace' 
      }, { status: 400 });
    }

    // Remove membership
    await base44.asServiceRole.entities.Membership.delete(targetMembership.id);

    // Audit log
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id,
      user_id: user.id,
      user_email: user.email,
      action: 'remove_member',
      entity_type: 'Membership',
      metadata: {
        removed_user: normalizedTargetEmail,
        removed_role: targetMembership.role,
        actor_role: actorMembership.role
      }
    }).catch(() => {});

    return Response.json({
      success: true,
      message: `${normalizedTargetEmail} removed from workspace`
    });

  } catch (error) {
    console.error('Error removing member:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});