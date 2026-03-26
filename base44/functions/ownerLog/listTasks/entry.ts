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

    const { status, priority, area } = await req.json();

    // Build filter
    const filter = {};
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (area) filter.area = area;

    const tasks = await base44.asServiceRole.entities.OwnerTask.filter(filter, '-created_date');

    return Response.json({ tasks });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});