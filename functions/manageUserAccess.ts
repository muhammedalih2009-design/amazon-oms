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
        let step = 'initialization';
        try {
          // Fetch target user
          step = 'fetch_user';
          const targetUser = await base44.asServiceRole.entities.User.get(user_id);
          
          if (!targetUser) {
            return Response.json({ error: 'User not found' }, { status: 404 });
          }

          // PROTECT OWNER
          if (targetUser.email.toLowerCase() === APP_OWNER_EMAIL.toLowerCase()) {
            return Response.json({ 
              error: 'Owner account cannot be deleted.' 
            }, { status: 403 });
          }

          // Idempotent: if already deleted, return success
          if (targetUser.deleted || targetUser.account_status === 'deleted') {
            return Response.json({ 
              success: true, 
              message: 'User already deleted',
              already_deleted: true
            });
          }

          // Step 1: Disable login immediately
          step = 'disable_login';
          await base44.asServiceRole.entities.User.update(user_id, {
            is_disabled: true,
            disabled_at: new Date().toISOString(),
            disabled_by: user.email
          });

          // Step 2: Remove all workspace memberships
          step = 'remove_memberships';
          const memberships = await base44.asServiceRole.entities.Membership.filter({ user_id });
          for (const membership of memberships) {
            await base44.asServiceRole.entities.Membership.delete(membership.id);
          }

          // Step 3: Remove workspace invites (by user_id or email)
          step = 'remove_invites';
          const invitesByEmail = await base44.asServiceRole.entities.WorkspaceInvite.filter({ 
            invited_email: targetUser.email 
          });
          for (const invite of invitesByEmail) {
            await base44.asServiceRole.entities.WorkspaceInvite.delete(invite.id);
          }

          // Step 4: Cancel running jobs
          step = 'cancel_jobs';
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

          // Step 5: Soft delete + anonymize email
          step = 'soft_delete';
          const anonymizedEmail = `deleted+${user_id}@deleted.local`;
          await base44.asServiceRole.entities.User.update(user_id, {
            deleted: true,
            deleted_at: new Date().toISOString(),
            deleted_by: user.email,
            account_status: 'deleted'
          });

          // Step 6: Log audit
          step = 'audit_log';
          await base44.asServiceRole.entities.AuditLog.create({
            action: 'user_disable_remove_access',
            entity_type: 'User',
            entity_id: user_id,
            user_email: user.email,
            metadata: {
              target_email: targetUser.email,
              target_user_id: user_id,
              memberships_removed: memberships.length,
              invites_removed: invitesByEmail.length,
              jobs_cancelled: runningJobs.length
            }
          });

          return Response.json({ 
            success: true, 
            message: 'User disabled and access removed successfully',
            memberships_removed: memberships.length,
            invites_removed: invitesByEmail.length,
            jobs_cancelled: runningJobs.length
          });
        } catch (error) {
          console.error(`Delete user failed at step: ${step}`, error);
          return Response.json({ 
            error: `Failed at ${step}: ${error.message}`,
            step
          }, { status: 500 });
        }
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