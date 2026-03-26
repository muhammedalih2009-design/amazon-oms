import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { guardWorkspaceAccess, requireWorkspaceId } from './helpers/guardWorkspaceAccess.js';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();

    // SECURITY: Require and validate workspace_id
    const workspace_id = requireWorkspaceId(payload);

    // SECURITY: Verify user has access to this workspace
    const membership = await guardWorkspaceAccess(base44, user, workspace_id);

    // Only owner/admin can delete all SKUs
    if (!['owner', 'admin'].includes(membership.role)) {
      return Response.json({ 
        ok: false, 
        error: 'Admin access required' 
      }, { status: 403 });
    }

    console.log(`[Start Delete All SKUs] User ${user.email} starting job for workspace ${workspace_id}`);

    // P0: Check for existing delete_all_skus jobs (prevent duplicates)
    const existingJobs = await base44.asServiceRole.entities.BackgroundJob.filter({
      tenant_id: workspace_id,
      job_type: 'delete_all_skus',
      status: { $in: ['running', 'cancelling', 'queued', 'throttled'] }
    });

    if (existingJobs.length > 0) {
      return Response.json({ 
        ok: false, 
        error: 'A delete_all_skus job is already running or queued for this workspace' 
      }, { status: 400 });
    }

    // Get SKU count for progress tracking
    const skus = await base44.asServiceRole.entities.SKU.filter({ tenant_id: workspace_id });

    // Create job record
    const job = await base44.asServiceRole.entities.BackgroundJob.create({
      tenant_id: workspace_id,
      job_type: 'delete_all_skus',
      status: 'queued',
      priority: 'low',
      progress_percent: 0,
      processed_count: 0,
      total_count: skus.length,
      success_count: 0,
      failed_count: 0,
      actor_user_id: user.id,
      started_by: user.email,
      started_at: new Date().toISOString(),
      params: {
        total_skus: skus.length
      },
      meta: {
        phase: 'initializing',
        message: 'Preparing to delete SKUs...'
      }
    });

    console.log(`[Start Delete All SKUs] Created job ${job.id} with status ${job.status}`);

    // If no other jobs running, start execution immediately
    if (existingJobs.length === 0) {
      // Fire and forget - don't wait for response
      base44.functions.invoke('executeDeleteAllSkus', { job_id: job.id }).catch(err => {
        console.error('[Start Delete All SKUs] Failed to invoke executor:', err);
      });
    }

    return Response.json({
      ok: true,
      job_id: job.id,
      status: job.status,
      total_items: skus.length
    });

  } catch (error) {
    console.error('[Start Delete All SKUs] Error:', error);
    return Response.json({
      ok: false,
      error: error.message || 'Failed to start job'
    }, { status: 500 });
  }
});