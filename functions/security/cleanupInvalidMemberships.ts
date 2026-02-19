import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';

/**
 * P0 SECURITY MIGRATION: Clean up invalid memberships
 * - Remove memberships with null/invalid workspace_id
 * - Remove duplicate memberships (same user + workspace)
 * Admin-only one-time migration
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only app owner can run migration
    if (user.email.toLowerCase() !== APP_OWNER_EMAIL.toLowerCase()) {
      return Response.json({ error: 'Forbidden: Owner access required' }, { status: 403 });
    }

    const { dry_run = true } = await req.json();

    const report = {
      timestamp: new Date().toISOString(),
      dry_run,
      invalid_workspace_ids: { found: 0, removed: 0, memberships: [] },
      duplicates: { found: 0, removed: 0, memberships: [] }
    };

    // Get all memberships
    const allMemberships = await base44.asServiceRole.entities.Membership.filter({});

    // Get all valid workspace IDs
    const allWorkspaces = await base44.asServiceRole.entities.Tenant.filter({});
    const validWorkspaceIds = new Set(allWorkspaces.map(w => w.id));

    // 1. Find memberships with invalid workspace_id
    const invalidMemberships = allMemberships.filter(m => 
      !m.tenant_id || !validWorkspaceIds.has(m.tenant_id)
    );

    report.invalid_workspace_ids.found = invalidMemberships.length;
    report.invalid_workspace_ids.memberships = invalidMemberships.map(m => ({
      membership_id: m.id,
      user_email: m.user_email,
      workspace_id: m.tenant_id,
      created_date: m.created_date
    }));

    if (!dry_run) {
      for (const membership of invalidMemberships) {
        try {
          await base44.asServiceRole.entities.Membership.delete(membership.id);
          report.invalid_workspace_ids.removed++;
        } catch (error) {
          console.error(`Failed to remove invalid membership ${membership.id}:`, error);
        }
      }
    }

    // 2. Find duplicate memberships (same user + workspace)
    const membershipKeys = {};
    const duplicates = [];

    for (const membership of allMemberships) {
      if (!validWorkspaceIds.has(membership.tenant_id)) continue; // Already handled above

      const key = `${membership.tenant_id}:${membership.user_email}`;
      
      if (membershipKeys[key]) {
        // Duplicate found - keep oldest, mark newer for deletion
        duplicates.push(membership);
      } else {
        membershipKeys[key] = membership;
      }
    }

    report.duplicates.found = duplicates.length;
    report.duplicates.memberships = duplicates.map(m => ({
      membership_id: m.id,
      user_email: m.user_email,
      workspace_id: m.tenant_id,
      role: m.role,
      created_date: m.created_date
    }));

    if (!dry_run) {
      for (const membership of duplicates) {
        try {
          await base44.asServiceRole.entities.Membership.delete(membership.id);
          report.duplicates.removed++;
        } catch (error) {
          console.error(`Failed to remove duplicate membership ${membership.id}:`, error);
        }
      }
    }

    // Log migration execution
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id: 'global',
      user_id: user.id,
      user_email: user.email,
      action: 'membership_cleanup_migration',
      entity_type: 'security_migration',
      metadata: { 
        dry_run,
        invalid_found: report.invalid_workspace_ids.found,
        invalid_removed: report.invalid_workspace_ids.removed,
        duplicates_found: report.duplicates.found,
        duplicates_removed: report.duplicates.removed
      }
    }).catch(() => {});

    return Response.json(report);

  } catch (error) {
    console.error('Migration error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});