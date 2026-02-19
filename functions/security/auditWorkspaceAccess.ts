import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';

/**
 * P0 SECURITY AUDIT: List all workspace memberships for security review
 * Admin-only function
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only app owner can run audit
    if (user.email.toLowerCase() !== APP_OWNER_EMAIL.toLowerCase()) {
      return Response.json({ error: 'Forbidden: Owner access required' }, { status: 403 });
    }

    const { workspace_id } = await req.json();

    // Get all workspaces or specific workspace
    let workspaces;
    if (workspace_id) {
      workspaces = await base44.asServiceRole.entities.Tenant.filter({ id: workspace_id });
    } else {
      workspaces = await base44.asServiceRole.entities.Tenant.filter({});
    }

    // Get all memberships
    const allMemberships = await base44.asServiceRole.entities.Membership.filter(
      workspace_id ? { workspace_id } : {}
    );

    // Build audit report
    const report = {
      timestamp: new Date().toISOString(),
      total_workspaces: workspaces.length,
      total_memberships: allMemberships.length,
      workspaces: []
    };

    for (const workspace of workspaces) {
      const members = allMemberships.filter(m => m.tenant_id === workspace.id);
      
      report.workspaces.push({
        workspace_id: workspace.id,
        workspace_name: workspace.name,
        workspace_slug: workspace.slug,
        created_date: workspace.created_date,
        member_count: members.length,
        members: members.map(m => ({
          user_id: m.user_id,
          user_email: m.user_email,
          role: m.role,
          joined_date: m.created_date,
          membership_id: m.id
        }))
      });
    }

    // Flag suspicious patterns
    const userWorkspaceCounts = {};
    allMemberships.forEach(m => {
      userWorkspaceCounts[m.user_email] = (userWorkspaceCounts[m.user_email] || 0) + 1;
    });

    report.suspicious_users = Object.entries(userWorkspaceCounts)
      .filter(([email, count]) => count > 5 && email.toLowerCase() !== APP_OWNER_EMAIL.toLowerCase())
      .map(([email, count]) => ({ email, workspace_count: count }));

    // Log audit execution
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id: workspace_id || 'global',
      user_id: user.id,
      user_email: user.email,
      action: 'workspace_access_audit',
      entity_type: 'security_audit',
      metadata: { 
        total_workspaces: workspaces.length,
        total_memberships: allMemberships.length,
        suspicious_count: report.suspicious_users.length
      }
    }).catch(() => {});

    return Response.json(report);

  } catch (error) {
    console.error('Audit error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});