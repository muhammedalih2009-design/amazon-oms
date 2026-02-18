import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { job_id } = await req.json();

    if (!job_id) {
      return Response.json({ error: 'job_id required' }, { status: 400 });
    }

    // Get job
    const job = await base44.asServiceRole.entities.BackgroundJob.get(job_id);
    if (!job) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    // Validate permission
    const isPlatformAdmin = user.role === 'admin' || user.email === 'your-admin@email.com';
    if (!isPlatformAdmin) {
      const memberships = await base44.asServiceRole.entities.Membership.filter({
        workspace_id: job.tenant_id,
        user_id: user.id
      });
      
      const isWorkspaceAdmin = memberships.some(m => m.role === 'owner' || m.role === 'admin');
      if (!isWorkspaceAdmin) {
        return Response.json({ error: 'Permission denied' }, { status: 403 });
      }
    }

    // Validate status
    if (!['running', 'throttled', 'pausing', 'resuming'].includes(job.status)) {
      return Response.json({ 
        error: `Cannot force stop job with status: ${job.status}` 
      }, { status: 400 });
    }

    // Update to cancelling and mark as non-resumable
    await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
      status: 'cancelling',
      can_resume: false
    });

    // Audit log
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id: job.tenant_id,
      user_id: user.id,
      user_email: user.email,
      action: 'job_force_stop_requested',
      entity_type: 'BackgroundJob',
      entity_id: job_id,
      metadata: {
        job_type: job.job_type,
        previous_status: job.status
      }
    });

    return Response.json({
      success: true,
      message: 'Job force stop requested'
    });
  } catch (error) {
    console.error('Error force stopping job:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});