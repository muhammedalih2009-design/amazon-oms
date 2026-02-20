import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only app owner can manage users
    if (user.email !== APP_OWNER_EMAIL) {
      return Response.json({ error: 'Forbidden: Only app owner can manage users' }, { status: 403 });
    }

    const { action, user_id, membership_id, workspace_id } = await req.json();

    if (!action || !user_id) {
      return Response.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Safety check: cannot perform actions on self
    if (user_id === user.id) {
      return Response.json({ error: 'Cannot perform this action on yourself' }, { status: 400 });
    }

    switch (action) {
      case 'remove_membership': {
        if (!membership_id) {
          return Response.json({ error: 'Missing membership_id' }, { status: 400 });
        }

        // P0: Delete membership using service role
        await base44.asServiceRole.entities.Membership.delete(membership_id);

        // Log audit
        await base44.asServiceRole.entities.AuditLog.create({
          action: 'membership_removed',
          entity_type: 'Membership',
          entity_id: membership_id,
          user_email: user.email,
          metadata: {
            target_user_id: user_id,
            workspace_id: workspace_id
          }
        });

        return Response.json({ 
          success: true, 
          message: 'Membership removed successfully' 
        });
      }

      case 'remove_all_memberships': {
        // Get all memberships for this user
        const memberships = await base44.asServiceRole.entities.Membership.filter({ user_id });

        // Delete all memberships
        for (const membership of memberships) {
          await base44.asServiceRole.entities.Membership.delete(membership.id);
        }

        // Log audit
        await base44.asServiceRole.entities.AuditLog.create({
          action: 'all_memberships_removed',
          entity_type: 'User',
          entity_id: user_id,
          user_email: user.email,
          metadata: {
            memberships_removed: memberships.length
          }
        });

        return Response.json({ 
          success: true, 
          memberships_removed: memberships.length 
        });
      }

      case 'disable_user': {
        // Update user to mark as disabled
        const targetUser = await base44.asServiceRole.entities.User.get(user_id);
        
        if (!targetUser) {
          return Response.json({ error: 'User not found' }, { status: 404 });
        }

        // Mark user as disabled (we'll add a disabled field to User entity)
        await base44.asServiceRole.entities.User.update(user_id, {
          is_disabled: true,
          disabled_at: new Date().toISOString(),
          disabled_by: user.email
        });

        // Log audit
        await base44.asServiceRole.entities.AuditLog.create({
          action: 'user_disabled',
          entity_type: 'User',
          entity_id: user_id,
          user_email: user.email,
          metadata: {
            target_email: targetUser.email
          }
        });

        return Response.json({ 
          success: true, 
          message: 'User disabled successfully' 
        });
      }

      case 'delete_user': {
        // P0: Safe soft delete with cleanup
        const targetUser = await base44.asServiceRole.entities.User.get(user_id);
        
        if (!targetUser) {
          return Response.json({ error: 'User not found' }, { status: 404 });
        }

        // P0: PROTECT OWNER
        if (targetUser.email.toLowerCase() === 'muhammedalih.2009@gmail.com') {
          return Response.json({ 
            error: 'Owner account cannot be deleted.' 
          }, { status: 403 });
        }

        // 1) Remove all workspace memberships
        const memberships = await base44.asServiceRole.entities.Membership.filter({ user_id });
        for (const membership of memberships) {
          await base44.asServiceRole.entities.Membership.delete(membership.id);
        }

        // 2) Cancel all running jobs created by this user
        const runningJobs = await base44.asServiceRole.entities.BackgroundJob.filter({
          created_by: targetUser.email,
          status: { $in: ['running', 'queued', 'throttled', 'paused'] }
        });
        for (const job of runningJobs) {
          await base44.asServiceRole.entities.BackgroundJob.update(job.id, {
            status: 'cancelled',
            finished_at: new Date().toISOString(),
            progress: {
              ...job.progress,
              message: 'Cancelled due to user deletion'
            }
          });
        }

        // 3) Soft delete user (NEVER hard delete)
        await base44.asServiceRole.entities.User.update(user_id, {
          deleted: true,
          deleted_at: new Date().toISOString(),
          deleted_by: user.email,
          account_status: 'deleted'
        });

        // Log audit (DO NOT delete audit logs - keep for compliance)
        await base44.asServiceRole.entities.AuditLog.create({
          action: 'user_deleted',
          entity_type: 'User',
          entity_id: user_id,
          user_email: user.email,
          metadata: {
            target_email: targetUser.email,
            memberships_removed: memberships.length,
            jobs_cancelled: runningJobs.length
          }
        });

        return Response.json({ 
          success: true, 
          message: 'User deleted successfully',
          memberships_removed: memberships.length,
          jobs_cancelled: runningJobs.length
        });
      }

      default:
        return Response.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Error managing user access:', error);
    return Response.json({ 
      error: error.message || 'Internal server error' 
    }, { status: 500 });
  }
});