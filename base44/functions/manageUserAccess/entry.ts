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
    if (user.email.toLowerCase() !== APP_OWNER_EMAIL.toLowerCase()) {
      return Response.json({ error: 'Forbidden: Only app owner can manage users' }, { status: 403 });
    }

    const { action, user_id, membership_id, workspace_id } = await req.json();

    if (!action) {
      return Response.json({ error: 'Missing action parameter' }, { status: 400 });
    }

    // For most actions, user_id is required
    if (action !== 'test' && !user_id) {
      return Response.json({ error: 'Missing user_id parameter' }, { status: 400 });
    }

    // Get current user's PlatformUser record
    const currentUsers = await base44.asServiceRole.entities.PlatformUser.filter({ 
      email: user.email 
    });
    const currentPlatformUser = currentUsers && currentUsers.length > 0 ? currentUsers[0] : null;

    switch (action) {
      case 'remove_membership': {
        if (!membership_id) {
          return Response.json({ error: 'Missing membership_id' }, { status: 400 });
        }

        await base44.asServiceRole.entities.WorkspaceMember.delete(membership_id);

        if (currentPlatformUser) {
          await base44.asServiceRole.entities.AuditLog.create({
            workspace_id: workspace_id || null,
            actor_user_id: currentPlatformUser.id,
            action: 'workspace_member_removed',
            target_type: 'WorkspaceMember',
            target_id: membership_id,
            meta: {
              target_user_id: user_id,
              workspace_id: workspace_id
            }
          });
        }

        return Response.json({ 
          success: true, 
          message: 'Membership removed successfully' 
        });
      }

      case 'remove_all_memberships': {
        const members = await base44.asServiceRole.entities.WorkspaceMember.filter({ user_id });

        for (const member of members) {
          await base44.asServiceRole.entities.WorkspaceMember.delete(member.id);
        }

        if (currentPlatformUser) {
          await base44.asServiceRole.entities.AuditLog.create({
            workspace_id: null,
            actor_user_id: currentPlatformUser.id,
            action: 'all_workspace_memberships_removed',
            target_type: 'PlatformUser',
            target_id: user_id,
            meta: {
              memberships_removed: members.length
            }
          });
        }

        return Response.json({ 
          success: true, 
          memberships_removed: members.length 
        });
      }

      case 'disable_user': {
        const targetUser = await base44.asServiceRole.entities.PlatformUser.get(user_id);
        
        if (!targetUser) {
          return Response.json({ error: 'User not found' }, { status: 404 });
        }

        await base44.asServiceRole.entities.PlatformUser.update(user_id, {
          status: 'disabled'
        });

        if (currentPlatformUser) {
          await base44.asServiceRole.entities.AuditLog.create({
            workspace_id: null,
            actor_user_id: currentPlatformUser.id,
            action: 'platform_user_disabled',
            target_type: 'PlatformUser',
            target_id: user_id,
            meta: {
              target_email: targetUser.email
            }
          });
        }

        return Response.json({ 
          success: true, 
          message: 'User disabled successfully' 
        });
      }

      case 'delete_user': {
        let step = 'initialization';
        try {
          step = 'fetch_user';
          const targetUser = await base44.asServiceRole.entities.PlatformUser.get(user_id);
          
          if (!targetUser) {
            return Response.json({ error: 'User not found' }, { status: 404 });
          }

          if (targetUser.email.toLowerCase() === APP_OWNER_EMAIL.toLowerCase()) {
            return Response.json({ 
              error: 'Owner account cannot be deleted.' 
            }, { status: 403 });
          }

          if (targetUser.deleted_at) {
            return Response.json({ 
              success: true, 
              message: 'User already deleted',
              already_deleted: true
            });
          }

          step = 'disable_user';
          await base44.asServiceRole.entities.PlatformUser.update(user_id, {
            status: 'disabled'
          });

          step = 'remove_memberships';
          const members = await base44.asServiceRole.entities.WorkspaceMember.filter({ user_id });
          let memberCount = 0;
          for (const member of members) {
            try {
              await base44.asServiceRole.entities.WorkspaceMember.delete(member.id);
              memberCount++;
            } catch (e) {
              console.error(`Failed to delete member ${member.id}:`, e);
            }
          }

          step = 'revoke_invites';
          const invites = await base44.asServiceRole.entities.WorkspaceInvite.filter({ 
            email: targetUser.email,
            status: 'pending'
          });
          let inviteCount = 0;
          for (const invite of invites) {
            try {
              await base44.asServiceRole.entities.WorkspaceInvite.update(invite.id, {
                status: 'revoked'
              });
              inviteCount++;
            } catch (e) {
              console.error(`Failed to revoke invite ${invite.id}:`, e);
            }
          }

          step = 'cancel_jobs';
          const jobs = await base44.asServiceRole.entities.BackgroundJob.filter({
            status: { $in: ['running', 'queued', 'paused'] }
          });
          let jobCount = 0;
          for (const job of jobs) {
            try {
              await base44.asServiceRole.entities.BackgroundJob.update(job.id, {
                status: 'cancelled',
                cancel_requested: true,
                finished_at: new Date().toISOString()
              });
              jobCount++;
            } catch (e) {
              console.error(`Failed to cancel job ${job.id}:`, e);
            }
          }

          step = 'soft_delete';
          await base44.asServiceRole.entities.PlatformUser.update(user_id, {
            deleted_at: new Date().toISOString()
          });

          step = 'audit_log';
          if (currentPlatformUser) {
            try {
              await base44.asServiceRole.entities.AuditLog.create({
                workspace_id: null,
                actor_user_id: currentPlatformUser.id,
                action: 'platform_user_soft_deleted',
                target_type: 'PlatformUser',
                target_id: user_id,
                meta: {
                  target_email: targetUser.email,
                  memberships_removed: memberCount,
                  invites_revoked: inviteCount,
                  jobs_cancelled: jobCount
                }
              });
            } catch (e) {
              console.error('Failed to create audit log:', e);
            }
          }

          return Response.json({ 
            success: true, 
            message: 'User disabled and access removed successfully',
            memberships_removed: memberCount,
            invites_revoked: inviteCount,
            jobs_cancelled: jobCount
          });
        } catch (error) {
          console.error(`Delete user failed at step: ${step}`, error);
          return Response.json({ 
            error: `Failed at step ${step}: ${error.message}`,
            step,
            details: error.stack
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