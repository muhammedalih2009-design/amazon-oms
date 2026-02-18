import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id } = await req.json();

    if (!workspace_id) {
      return Response.json({ 
        ok: false, 
        error: 'workspace_id required' 
      }, { status: 400 });
    }

    console.log(`[Start Delete All SKUs] User ${user.email} starting job for workspace ${workspace_id}`);

    // Check if there's already a running job for this workspace
    const existingJobs = await base44.asServiceRole.entities.BackgroundJob.filter({
      tenant_id: workspace_id,
      status: 'running'
    });

    if (existingJobs.length > 0) {
      console.log(`[Start Delete All SKUs] Found ${existingJobs.length} running jobs, queuing this one`);
    }

    // Get SKU count for progress tracking
    const skus = await base44.asServiceRole.entities.SKU.filter({ tenant_id: workspace_id });

    // Create job record
    const job = await base44.asServiceRole.entities.BackgroundJob.create({
      tenant_id: workspace_id,
      job_type: 'delete_all_skus',
      status: existingJobs.length > 0 ? 'queued' : 'running',
      priority: 'low',
      progress: {
        current: 0,
        total: skus.length,
        percent: 0,
        phase: 'initializing',
        message: 'Preparing to delete SKUs...'
      },
      params: {
        total_skus: skus.length
      },
      started_by: user.email,
      started_at: existingJobs.length === 0 ? new Date().toISOString() : null
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