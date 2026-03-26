import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const { scope = 'workspace', workspace_id, status_filter, limit = 200, cursor } = await req.json();

    // Platform admin can access 'all' scope; others are limited to 'workspace'
    let queryScope = scope;
    let targetWorkspaceId = workspace_id;

    // Check if user is platform admin (for now, using service role query since we don't have direct platform role)
    // In production, this would check user.platform_role or similar
    const isPlatformAdmin = user.role === 'admin'; // Basic check

    if (!isPlatformAdmin) {
      // Non-admins can only see their own workspace
      queryScope = 'workspace';
      // They must provide workspace_id
      if (!workspace_id) {
        return Response.json({ error: 'workspace_id required for non-admin users' }, { status: 400 });
      }
      targetWorkspaceId = workspace_id;
    } else if (queryScope === 'all') {
      // Platform admin requesting all workspaces
      targetWorkspaceId = null; // Null means all workspaces
    } else if (queryScope === 'workspace' && workspace_id) {
      targetWorkspaceId = workspace_id;
    }

    // Build query
    const query = {};
    if (targetWorkspaceId) {
      query.tenant_id = targetWorkspaceId;
    }
    if (status_filter && status_filter !== 'all') {
      if (status_filter === 'active') {
        query.status = { $in: ['running', 'queued', 'throttled', 'paused', 'cancelling', 'pausing', 'resuming'] };
      } else if (status_filter === 'completed') {
        query.status = { $in: ['completed', 'cancelled', 'failed'] };
      } else if (Array.isArray(status_filter)) {
        query.status = { $in: status_filter };
      }
    }

    // Fetch jobs with service role to bypass tenant filtering
    const jobs = await base44.asServiceRole.entities.BackgroundJob.filter(query, '-created_date', limit);

    // Enrich with workspace names if platform admin
    let enrichedJobs = jobs;
    if (isPlatformAdmin && queryScope === 'all') {
      const tenantIds = [...new Set(jobs.map(j => j.tenant_id))];
      if (tenantIds.length > 0) {
        const tenants = await base44.asServiceRole.entities.Tenant.filter(
          { id: { $in: tenantIds } }
        );
        const tenantMap = {};
        tenants.forEach(t => {
          tenantMap[t.id] = t.name || t.slug || t.id;
        });
        enrichedJobs = jobs.map(j => ({
          ...j,
          workspace_name: tenantMap[j.tenant_id] || j.tenant_id
        }));
      }
    }

    return Response.json({
      ok: true,
      jobs: enrichedJobs,
      count: enrichedJobs.length
    });
  } catch (error) {
    console.error('[List Monitoring Jobs]', error);
    return Response.json({
      error: error.message || 'Failed to list jobs'
    }, { status: 500 });
  }
});