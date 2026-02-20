import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PLATFORM_ADMIN_EMAIL = 'muhammedalih.2009@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // SECURITY: Platform admin only
    if (user.email.toLowerCase() !== PLATFORM_ADMIN_EMAIL.toLowerCase()) {
      return Response.json({ error: 'Forbidden: Platform admin access required' }, { status: 403 });
    }

    // Fetch all non-deleted workspaces
    const allWorkspaces = await base44.asServiceRole.entities.Tenant.filter({});
    const workspaces = allWorkspaces.filter(w => !w.deleted_at);

    return Response.json({
      success: true,
      workspaces: workspaces.map(w => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        created_date: w.created_date
      }))
    });

  } catch (error) {
    console.error('List all workspaces error:', error);
    return Response.json({ 
      error: error.message || 'Failed to list workspaces' 
    }, { status: 500 });
  }
});