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

    // Validate permission (Platform Admin OR workspace owner/admin)
    const isPlatformAdmin = user.role === 'admin' || user.email === 'your-admin@email.com';
    if (!isPlatformAdmin) {
      // Check if user is workspace owner/admin
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
    if (!['running', 'throttled'].includes(job.status)) {
      return Response.json({ 
        error: `Cannot pause job with status: ${job.status}` 
      }, { status: 400 });
    }

    // Update to pausing
    await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
      status: 'pausing'
    });

    // Audit log
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id: job.tenant_id,
      user_id: user.id,
      user_email: user.email,
      action: 'job_pause_requested',
      entity_type: 'BackgroundJob',
      entity_id: job_id,
      metadata: {
        job_type: job.job_type,
        previous_status: job.status
      }
    });

    return Response.json({
      success: true,
      message: 'Job pause requested'
    });
  } catch (error) {
    console.error('Error pausing job:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});