import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { backupJobId, backupData, targetWorkspaceId } = await req.json();

    if (!backupJobId && !backupData) {
      return Response.json({ error: 'Must provide backupJobId or backupData' }, { status: 400 });
    }

    // Get backup info
    let backupInfo = {};
    if (backupJobId && backupJobId !== 'uploaded') {
      const backupJob = await base44.asServiceRole.entities.BackupJob.get(backupJobId);
      if (!backupJob) {
        return Response.json({ error: 'Backup job not found' }, { status: 404 });
      }
      backupInfo = {
        source_workspace_id: backupJob.source_workspace_id,
        source_workspace_name: backupJob.source_workspace_name,
        backup_data: backupJob.backup_data
      };
    } else {
      // Uploaded backup
      const data = backupData?.data || backupData?.tables || backupData;
      const firstItem = data?.stores?.[0] || data?.skus?.[0] || data?.orders?.[0];
      backupInfo = {
        source_workspace_id: firstItem?.tenant_id || 'unknown',
        source_workspace_name: 'Uploaded Backup',
        backup_data: JSON.stringify(backupData)
      };
    }

    // Get target workspace
    const targetWorkspace = await base44.asServiceRole.entities.Tenant.get(targetWorkspaceId);
    if (!targetWorkspace) {
      return Response.json({ error: 'Target workspace not found' }, { status: 404 });
    }

    // Create restore job
    const restoreJob = await base44.asServiceRole.entities.RestoreJob.create({
      backup_job_id: backupJobId || 'uploaded',
      target_workspace_id: targetWorkspaceId,
      target_workspace_name: targetWorkspace.name,
      source_workspace_id: backupInfo.source_workspace_id,
      source_workspace_name: backupInfo.source_workspace_name,
      status: 'queued',
      current_phase: 'initializing',
      progress: {
        processed_rows: 0,
        total_rows: 0,
        entities_completed: [],
        entities_failed: []
      },
      checkpoint_payload: {
        id_map: {},
        completed_entities: []
      },
      error_log: [],
      backup_data: backupInfo.backup_data,
      restored_by: user.email,
      started_at: new Date().toISOString(),
      resumed_count: 0
    });

    // Trigger async execution (fire and forget)
    base44.asServiceRole.functions.invoke('executeRestoreJob', {
      restoreJobId: restoreJob.id
    }).catch(err => {
      console.error('Failed to trigger async execution:', err);
    });

    return Response.json({ 
      success: true, 
      restoreJobId: restoreJob.id 
    });
  } catch (error) {
    console.error('Start restore error:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});