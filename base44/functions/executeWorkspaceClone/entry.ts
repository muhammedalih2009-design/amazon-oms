import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(job, message) {
  console.log(`[Clone Job ${job.id}] ${message}`);
}

async function updateJob(base44, jobId, updates) {
  await base44.asServiceRole.entities.WorkspaceCloneJob.update(jobId, updates);
}

async function addLog(base44, job, message) {
  log(job, message);
  const currentJob = await base44.asServiceRole.entities.WorkspaceCloneJob.get(job.id);
  const logs = currentJob.logs || [];
  logs.push(`[${new Date().toISOString()}] ${message}`);
  await updateJob(base44, job.id, { logs });
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    const { job_id } = await req.json();
    const job = await base44.asServiceRole.entities.WorkspaceCloneJob.get(job_id);
    
    if (!job) {
      return Response.json({ ok: false, error: 'Job not found' }, { status: 404 });
    }

    await updateJob(base44, job.id, { 
      status: 'running',
      progress: { phase: 'creating_workspace', percent: 5, message: 'Creating new workspace...' }
    });

    // Step 1: Create new workspace
    await addLog(base44, job, 'Creating new workspace');
    const newWorkspace = await base44.asServiceRole.entities.Tenant.create({
      name: job.new_workspace_name,
      slug: job.new_workspace_slug,
      settings: {}
    });
    
    await updateJob(base44, job.id, { 
      new_workspace_id: newWorkspace.id,
      progress: { phase: 'copying_modules', percent: 10, message: 'Copying modules...' }
    });
    await addLog(base44, job, `New workspace created: ${newWorkspace.id}`);

    // Step 2: Copy WorkspaceModules
    const sourceModules = await base44.asServiceRole.entities.WorkspaceModule.filter({
      workspace_id: job.source_workspace_id
    });
    
    if (sourceModules.length > 0) {
      await base44.asServiceRole.entities.WorkspaceModule.bulkCreate(
        sourceModules.map(m => ({
          workspace_id: newWorkspace.id,
          module_key: m.module_key,
          enabled: m.enabled
        }))
      );
      await addLog(base44, job, `Copied ${sourceModules.length} modules`);
    }

    // Step 3: Create initial members
    await updateJob(base44, job.id, { 
      progress: { phase: 'adding_members', percent: 15, message: 'Adding members...' }
    });
    
    for (const member of job.initial_members || []) {
      const users = await base44.asServiceRole.entities.User.filter({ email: member.email });
      let userId = users[0]?.id;
      
      if (!userId) {
        const newUser = await base44.asServiceRole.entities.User.create({
          email: member.email,
          full_name: member.name || member.email
        });
        userId = newUser.id;
      }
      
      await base44.asServiceRole.entities.Membership.create({
        tenant_id: newWorkspace.id,
        user_id: userId,
        user_email: member.email,
        role: member.role || 'staff'
      });
    }
    await addLog(base44, job, `Added ${job.initial_members?.length || 0} members`);

    // Step 4: Clone data with ID remapping
    const idMappings = {};
    
    // Define entities to clone in dependency order
    const entitiesToClone = [
      { name: 'Supplier', fks: [] },
      { name: 'Store', fks: [] },
      { name: 'SKU', fks: ['supplier_id'] },
      { name: 'CurrentStock', fks: ['sku_id'] },
      { name: 'Order', fks: ['store_id'] },
      { name: 'OrderLine', fks: ['order_id', 'sku_id', 'actual_sku_id'] },
      { name: 'Purchase', fks: ['sku_id', 'supplier_id'] },
      { name: 'StockMovement', fks: ['sku_id'] },
      { name: 'ProfitabilityLine', fks: ['order_id', 'order_line_id'] },
      { name: 'Task', fks: [] },
      { name: 'TaskComment', fks: ['task_id'] },
      { name: 'TaskChecklistItem', fks: ['task_id'] }
    ];

    for (let i = 0; i < entitiesToClone.length; i++) {
      const entity = entitiesToClone[i];
      const percentStart = 20;
      const percentRange = 70;
      const percent = percentStart + Math.floor((i / entitiesToClone.length) * percentRange);
      
      await updateJob(base44, job.id, { 
        progress: { 
          phase: `cloning_${entity.name.toLowerCase()}`, 
          percent, 
          message: `Cloning ${entity.name}...` 
        }
      });

      try {
        const sourceRows = await base44.asServiceRole.entities[entity.name].filter({
          tenant_id: job.source_workspace_id
        });

        if (sourceRows.length === 0) {
          await addLog(base44, job, `${entity.name}: No rows to clone`);
          continue;
        }

        idMappings[entity.name] = {};
        const newRows = [];

        for (const row of sourceRows) {
          const newRow = {
            ...row,
            tenant_id: newWorkspace.id
          };
          
          // Remove old ID
          delete newRow.id;
          delete newRow.created_date;
          delete newRow.updated_date;
          delete newRow.created_by;

          // Remap foreign keys
          for (const fk of entity.fks) {
            if (newRow[fk]) {
              const fkEntityName = fk === 'supplier_id' ? 'Supplier' :
                                  fk === 'store_id' ? 'Store' :
                                  fk === 'sku_id' ? 'SKU' :
                                  fk === 'actual_sku_id' ? 'SKU' :
                                  fk === 'order_id' ? 'Order' :
                                  fk === 'order_line_id' ? 'OrderLine' :
                                  fk === 'task_id' ? 'Task' : null;

              if (fkEntityName && idMappings[fkEntityName]?.[newRow[fk]]) {
                newRow[fk] = idMappings[fkEntityName][newRow[fk]];
              }
            }
          }

          newRows.push({ oldId: row.id, newRow });
        }

        // Bulk create in batches
        const BATCH_SIZE = 100;
        for (let i = 0; i < newRows.length; i += BATCH_SIZE) {
          const batch = newRows.slice(i, i + BATCH_SIZE);
          const created = await base44.asServiceRole.entities[entity.name].bulkCreate(
            batch.map(r => r.newRow)
          );

          // Store mappings
          for (let j = 0; j < created.length; j++) {
            idMappings[entity.name][batch[j].oldId] = created[j].id;
          }

          await sleep(200);
        }

        await addLog(base44, job, `${entity.name}: Cloned ${sourceRows.length} rows`);
      } catch (error) {
        await addLog(base44, job, `${entity.name}: ERROR - ${error.message}`);
        console.error(`[Clone] Error cloning ${entity.name}:`, error);
      }
    }

    // Step 5: Recompute workspace
    await updateJob(base44, job.id, { 
      progress: { phase: 'recomputing', percent: 95, message: 'Recomputing stats...' },
      id_mappings: idMappings
    });
    await addLog(base44, job, 'Starting recompute');

    try {
      await base44.functions.invoke('recomputeWorkspace', { 
        workspaceId: newWorkspace.id 
      });
      await addLog(base44, job, 'Recompute completed');
    } catch (error) {
      await addLog(base44, job, `Recompute warning: ${error.message}`);
    }

    // Complete
    await updateJob(base44, job.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      progress: { phase: 'completed', percent: 100, message: 'Clone completed successfully' }
    });
    await addLog(base44, job, `Clone completed. New workspace: ${newWorkspace.id}`);

    return Response.json({ ok: true, new_workspace_id: newWorkspace.id });

  } catch (error) {
    console.error('[Clone Execute] Fatal error:', error);
    
    try {
      const { job_id } = await req.json();
      if (job_id) {
        const job = await base44.asServiceRole.entities.WorkspaceCloneJob.get(job_id);
        if (job) {
          await addLog(base44, job, `FATAL ERROR: ${error.message}`);
          await updateJob(base44, job_id, {
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: error.message
          });
        }
      }
    } catch (updateError) {
      console.error('[Clone Execute] Failed to update job:', updateError);
    }

    return Response.json({
      ok: false,
      error: error.message || 'Clone failed'
    }, { status: 500 });
  }
});