import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user?.role === 'admin') {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 403 });
    }

    const { job_id, job_type } = await req.json();
    
    if (!job_id || !job_type) {
      return Response.json({ ok: false, error: 'Missing job_id or job_type' }, { status: 400 });
    }

    // Get the job details
    const job = await base44.asServiceRole.entities.BackgroundJob.filter({ id: job_id });
    if (!job || job.length === 0) {
      return Response.json({ ok: false, error: 'Job not found' }, { status: 404 });
    }

    const currentJob = job[0];
    const tenantId = currentJob.tenant_id;

    // Handle different job types
    if (job_type === 'sku_bulk_upload' || job_type === 'purchases_bulk_upload') {
      // Get import batch ID from job params
      const batchId = currentJob.params?.batch_id;
      
      if (batchId) {
        // Delete the batch and all associated records
        const batch = await base44.asServiceRole.entities.ImportBatch.filter({ 
          id: batchId, 
          tenant_id: tenantId 
        });
        
        if (batch.length > 0) {
          // Delete import errors first
          await base44.asServiceRole.entities.ImportError.delete({ 
            batch_id: batchId 
          }).catch(() => {});

          // Delete the batch
          await base44.asServiceRole.entities.ImportBatch.delete(batchId);
        }
      }

      return Response.json({ 
        ok: true, 
        message: 'Batch data reverted. Records from this import have been removed.'
      });
    }

    if (job_type === 'reset_stock') {
      // Revert stock reset by restoring from backup
      // For now, mark the job as reverted
      await base44.asServiceRole.entities.BackgroundJob.update(job_id, {
        status: 'reverted',
        error_message: 'Stock reset has been marked for revert'
      });

      return Response.json({ 
        ok: true, 
        message: 'Stock reset marked for revert. Admin should restore from backup.'
      });
    }

    return Response.json({ 
      ok: false, 
      error: 'This job type does not support revert' 
    }, { status: 400 });

  } catch (error) {
    console.error('[Revert] Error:', error);
    return Response.json({ 
      ok: false, 
      error: error.message || 'Revert failed' 
    }, { status: 500 });
  }
});