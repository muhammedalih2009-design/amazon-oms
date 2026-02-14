import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Authenticate and verify super admin
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if super admin (strict check)
    const isSuperAdmin = user.role === 'admin' || user.email === 'admin@amazonoms.com';
    if (!isSuperAdmin) {
      return Response.json({ 
        error: 'Forbidden: Only super admin can repair memberships' 
      }, { status: 403 });
    }

    // Get all workspaces
    const workspaces = await base44.asServiceRole.entities.Tenant.filter({});
    
    let created = 0;
    let skipped = 0;
    const errors = [];

    for (const workspace of workspaces) {
      try {
        // Check if super admin already has membership
        const memberships = await base44.asServiceRole.entities.Membership.filter({
          tenant_id: workspace.id,
          user_id: user.id
        });

        if (memberships.length === 0) {
          // Create membership
          await base44.asServiceRole.entities.Membership.create({
            tenant_id: workspace.id,
            user_id: user.id,
            user_email: user.email,
            role: 'owner',
            permissions: {
              dashboard: { view: true, edit: true },
              tasks: { view: true, edit: true },
              skus: { view: true, edit: true },
              orders: { view: true, edit: true },
              purchases: { view: true, edit: true },
              returns: { view: true, edit: true },
              settlement: { view: true, edit: true },
              suppliers: { view: true, edit: true }
            }
          });
          created++;
        } else {
          skipped++;
        }
      } catch (error) {
        errors.push({
          workspace_id: workspace.id,
          workspace_name: workspace.name,
          error: error.message
        });
      }
    }

    return Response.json({
      success: true,
      total_workspaces: workspaces.length,
      memberships_created: created,
      memberships_skipped: skipped,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Repair memberships error:', error);
    return Response.json({ 
      error: error.message || 'Failed to repair memberships' 
    }, { status: 500 });
  }
});