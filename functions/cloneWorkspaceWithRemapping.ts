import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PLATFORM_ADMIN_EMAIL = 'muhammedalih.2009@gmail.com';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    const user = await base44.auth.me();
    if (!user || user.email !== PLATFORM_ADMIN_EMAIL) {
      return Response.json({ ok: false, error: 'Platform admin access required' }, { status: 403 });
    }

    const { source_workspace_id, new_workspace_name, new_workspace_slug, initial_members = [] } = await req.json();

    if (!source_workspace_id || !new_workspace_name) {
      return Response.json({ 
        ok: false, 
        error: 'source_workspace_id and new_workspace_name required' 
      }, { status: 400 });
    }

    console.log(`[Clone] Admin ${user.email} starting clone from ${source_workspace_id}`);

    // Create clone job record
    const job = await base44.asServiceRole.entities.WorkspaceCloneJob.create({
      source_workspace_id,
      new_workspace_name,
      new_workspace_slug: new_workspace_slug || new_workspace_name.toLowerCase().replace(/\s+/g, '-'),
      status: 'queued',
      initial_members,
      progress: {
        phase: 'initializing',
        percent: 0,
        message: 'Clone job created'
      },
      logs: ['Job created'],
      created_by: user.email,
      started_at: new Date().toISOString()
    });

    // Start execution in background
    base44.functions.invoke('executeWorkspaceClone', { job_id: job.id }).catch(err => {
      console.error('[Clone] Failed to start executor:', err);
    });

    return Response.json({
      ok: true,
      job_id: job.id,
      message: 'Clone job started'
    });

  } catch (error) {
    console.error('[Clone] Error:', error);
    return Response.json({
      ok: false,
      error: error.message || 'Failed to start clone'
    }, { status: 500 });
  }
});