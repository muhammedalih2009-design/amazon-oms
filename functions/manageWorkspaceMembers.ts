import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Workspace Member Management
 * 
 * Actions:
 * - list: List all members of a workspace
 * - add: Add a user to workspace
 * - update_role: Change member's role
 * - remove: Remove member from workspace
 * 
 * Permissions:
 * - super_admin: can manage any workspace
 * - workspace_admin/owner: can manage their workspace only
 */

Deno.serve(async (req) => {
  try {
    const db = createClientFromRequest(req);
    const user = await db.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { action, workspace_id, user_email, user_id, member_id, role } = await req.json();

    // Check if user is super admin
    const isSuperAdmin = user.role === 'admin' || user.email === 'admin@amazonoms.com';

    // For non-super-admin, verify they are admin/owner of the workspace
    if (!isSuperAdmin && workspace_id) {
      const membership = await db.entities.Membership.filter({
        workspace_id,
        user_id: user.id
      });

      if (membership.length === 0 || !['owner', 'admin'].includes(membership[0].role)) {
        return Response.json({
          error: 'Forbidden: Only workspace admin/owner can manage members'
        }, { status: 403 });
      }
    }

    // Handle actions
    switch (action) {
      case 'list': {
        if (!workspace_id) {
          return Response.json({ error: 'workspace_id required' }, { status: 400 });
        }

        const members = await db.entities.Membership.filter({ tenant_id: workspace_id });
        const users = await db.entities.User.filter({});
        
        const enrichedMembers = members.map(m => {
          const memberUser = users.find(u => u.id === m.user_id);
          return {
            ...m,
            user_name: memberUser?.full_name,
            user_email: memberUser?.email
          };
        });

        return Response.json({ ok: true, members: enrichedMembers });
      }

      case 'add': {
        if (!workspace_id || !user_email) {
          return Response.json({
            error: 'workspace_id and user_email required'
          }, { status: 400 });
        }

        // Find user by email
        const users = await db.entities.User.filter({ email: user_email });
        if (users.length === 0) {
          return Response.json({
            error: 'User not found. They must create an account first.'
          }, { status: 404 });
        }

        const targetUser = users[0];

        // Check if already a member
        const existing = await db.entities.Membership.filter({
          tenant_id: workspace_id,
          user_id: targetUser.id
        });

        if (existing.length > 0) {
          return Response.json({
            error: 'User is already a member of this workspace'
          }, { status: 400 });
        }

        // Create membership
        const newMember = await db.entities.Membership.create({
          tenant_id: workspace_id,
          user_id: targetUser.id,
          user_email: targetUser.email,
          role: role || 'member'
        });

        return Response.json({ ok: true, member: newMember });
      }

      case 'update_role': {
        if (!member_id || !role) {
          return Response.json({
            error: 'member_id and role required'
          }, { status: 400 });
        }

        await db.entities.Membership.update(member_id, { role });
        return Response.json({ ok: true });
      }

      case 'remove': {
        if (!member_id) {
          return Response.json({ error: 'member_id required' }, { status: 400 });
        }

        // Prevent removing the last owner
        const member = await db.entities.Membership.filter({ id: member_id });
        if (member.length > 0 && member[0].role === 'owner') {
          const allOwners = await db.entities.Membership.filter({
            tenant_id: member[0].tenant_id,
            role: 'owner'
          });

          if (allOwners.length === 1) {
            return Response.json({
              error: 'Cannot remove the last owner of a workspace'
            }, { status: 400 });
          }
        }

        await db.entities.Membership.delete(member_id);
        return Response.json({ ok: true });
      }

      default:
        return Response.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Workspace member management error:', error);
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});