import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';

/**
 * P0 SECURITY REPAIR: Remove unauthorized workspace memberships
 * Admin-only function for incident response
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only app owner can run repair
    if (user.email.toLowerCase() !== APP_OWNER_EMAIL.toLowerCase()) {
      return Response.json({ error: 'Forbidden: Owner access required' }, { status: 403 });
    }

    const { workspace_id, user_emails_to_remove, dry_run = true } = await req.json();

    if (!workspace_id || !user_emails_to_remove || !Array.isArray(user_emails_to_remove)) {
      return Response.json({ 
        error: 'Invalid input: workspace_id and user_emails_to_remove[] required' 
      }, { status: 400 });
    }

    // Find memberships to remove
    const membershipsToRemove = await base44.asServiceRole.entities.Membership.filter({
      workspace_id,
      user_email: { $in: user_emails_to_remove }
    });

    if (membershipsToRemove.length === 0) {
      return Response.json({ 
        message: 'No memberships found to remove',
        removed_count: 0
      });
    }

    const report = {
      workspace_id,
      dry_run,
      found_count: membershipsToRemove.length,
      removed_count: 0,
      memberships: membershipsToRemove.map(m => ({
        membership_id: m.id,
        user_email: m.user_email,
        role: m.role,
        created_date: m.created_date
      }))
    };

    if (!dry_run) {
      // Actually remove the memberships
      for (const membership of membershipsToRemove) {
        try {
          await base44.asServiceRole.entities.Membership.delete(membership.id);
          report.removed_count++;

          // Log revocation
          await base44.asServiceRole.entities.AuditLog.create({
            workspace_id,
            user_id: membership.user_id,
            user_email: membership.user_email,
            action: 'workspace_access_revoked',
            entity_type: 'membership',
            entity_id: membership.id,
            metadata: { 
              reason: 'security_repair',
              revoked_by: user.email,
              role: membership.role
            }
          }).catch(() => {});
        } catch (error) {
          console.error(`Failed to remove membership ${membership.id}:`, error);
        }
      }
    }

    // Log repair execution
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id,
      user_id: user.id,
      user_email: user.email,
      action: 'workspace_membership_repair',
      entity_type: 'security_repair',
      metadata: { 
        dry_run,
        found_count: report.found_count,
        removed_count: report.removed_count,
        user_emails: user_emails_to_remove
      }
    }).catch(() => {});

    return Response.json(report);

  } catch (error) {
    console.error('Repair error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});