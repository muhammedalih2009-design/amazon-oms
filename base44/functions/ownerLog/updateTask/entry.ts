import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Strict owner-only check
    if (!user || user.email.toLowerCase() !== APP_OWNER_EMAIL.toLowerCase()) {
      return Response.json({ error: 'Forbidden: Owner access only' }, { status: 403 });
    }

    const { task_id, updates } = await req.json();

    // Get current task
    const tasks = await base44.asServiceRole.entities.OwnerTask.filter({ id: task_id });
    if (tasks.length === 0) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

    const currentTask = tasks[0];
    const oldStatus = currentTask.status;

    // Update task
    const updatedTask = await base44.asServiceRole.entities.OwnerTask.update(task_id, updates);

    // Create timeline entry if status changed
    if (updates.status && updates.status !== oldStatus) {
      await base44.asServiceRole.entities.OwnerTaskUpdate.create({
        task_id,
        message: `Status changed from ${oldStatus} to ${updates.status}`,
        update_type: 'status_change',
        from_status: oldStatus,
        to_status: updates.status
      });
    }

    return Response.json({ task: updatedTask });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});