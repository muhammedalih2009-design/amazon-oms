import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id } = await req.json();

    if (!workspace_id) {
      return Response.json({ error: 'Missing workspace_id' }, { status: 400 });
    }

    // Verify workspace access
    const membership = await base44.entities.Membership.filter({
      tenant_id: workspace_id,
      user_id: user.id
    });

    if (!membership || membership.length === 0) {
      return Response.json({ error: 'No access to workspace' }, { status: 403 });
    }

    const member = membership[0];
    
    // Check permission: must have edit access for skus_products
    if (!member.permissions?.skus_products?.edit) {
      return Response.json({ 
        error: 'You do not have permission to reset stock. Edit access required for SKUs/Products.' 
      }, { status: 403 });
    }

    // Count total SKUs to reset
    const allStock = await base44.entities.CurrentStock.filter({ 
      tenant_id: workspace_id 
    });

    if (allStock.length === 0) {
      return Response.json({ 
        error: 'No stock records found to reset' 
      }, { status: 400 });
    }

    // Create BackgroundJob record with proper total_count
    const job = await base44.asServiceRole.entities.BackgroundJob.create({
      tenant_id: workspace_id,
      job_type: 'reset_stock',
      status: 'queued',
      priority: 'normal',
      total_count: allStock.length,
      processed_count: 0,
      success_count: 0,
      failed_count: 0,
      progress_percent: 0,
      params: {
        workspace_id: workspace_id
      },
      started_by: user.email,
      actor_user_id: user.id,
      meta: {
        total_stock_records: allStock.length
      }
    });

    // Trigger execution asynchronously (don't await)
    base44.asServiceRole.functions.invoke('executeResetStock', {
      job_id: job.id,
      workspace_id: workspace_id
    }).catch(err => {
      console.error('[startResetStock] Execution trigger failed:', err);
    });

    return Response.json({ 
      ok: true,
      job_id: job.id,
      total_items: allStock.length
    });

  } catch (error) {
    console.error('[startResetStock] Error:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});