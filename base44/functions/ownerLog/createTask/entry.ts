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

    const { title, description, priority, area, workspace_id } = await req.json();

    const task = await base44.asServiceRole.entities.OwnerTask.create({
      title,
      description: description || '',
      status: 'Backlog',
      priority: priority || 'P2',
      area: area || 'Other',
      workspace_id: workspace_id || null
    });

    // Create initial update
    await base44.asServiceRole.entities.OwnerTaskUpdate.create({
      task_id: task.id,
      message: 'Task created',
      update_type: 'comment'
    });

    return Response.json({ task });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});