import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';

/**
 * ONE-TIME MIGRATION: Reconcile WorkspaceMember → Membership
 * This ensures data integrity after architecture refactor
 * 
 * Only callable by app owner
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.email.toLowerCase() !== APP_OWNER_EMAIL.toLowerCase()) {
      return Response.json({ error: 'Forbidden: Owner only' }, { status: 403 });
    }

    const { mode = 'report' } = await req.json();
    
    // Fetch all WorkspaceMembers
    const workspaceMembers = await base44.asServiceRole.entities.WorkspaceMember.filter({});
    
    // Fetch all Memberships
    const memberships = await base44.asServiceRole.entities.Membership.filter({});
    
    const report = {
      total_workspace_members: workspaceMembers.length,
      total_memberships: memberships.length,
      missing_in_membership: [],
      duplicates_in_membership: [],
      field_mismatches: []
    };

    // Build membership lookup: tenant_id + user_id
    const membershipMap = {};
    for (const m of memberships) {
      const key = `${m.tenant_id}:${m.user_id}`;
      if (membershipMap[key]) {
        report.duplicates_in_membership.push({
          tenant_id: m.tenant_id,
          user_id: m.user_id,
          membership_ids: [membershipMap[key].id, m.id]
        });
      } else {
        membershipMap[key] = m;
      }
    }

    // Check each WorkspaceMember
    for (const wm of workspaceMembers) {
      const key = `${wm.workspace_id}:${wm.user_id}`;
      const existing = membershipMap[key];
      
      if (!existing) {
        report.missing_in_membership.push({
          workspace_id: wm.workspace_id,
          user_id: wm.user_id,
          user_email: wm.user_email,
          role: wm.role
        });
        
        // If mode = 'migrate', create Membership
        if (mode === 'migrate') {
          try {
            await base44.asServiceRole.entities.Membership.create({
              tenant_id: wm.workspace_id,
              user_id: wm.user_id,
              user_email: wm.user_email,
              role: wm.role,
              permissions: convertModulesToPermissions(wm.enabled_modules)
            });
          } catch (error) {
            console.error(`Failed to migrate ${key}:`, error);
          }
        }
      } else {
        // Check for role mismatch
        if (existing.role !== wm.role) {
          report.field_mismatches.push({
            workspace_id: wm.workspace_id,
            user_id: wm.user_id,
            workspace_member_role: wm.role,
            membership_role: existing.role
          });
        }
      }
    }

    return Response.json({
      ok: true,
      mode,
      report,
      recommendation: mode === 'report' 
        ? 'Review report. Call with mode=migrate to create missing Memberships.'
        : 'Migration completed. Review report for any issues.'
    });

  } catch (error) {
    console.error('Reconciliation error:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});

function convertModulesToPermissions(enabledModules) {
  if (!enabledModules) {
    return {
      dashboard: { view: true, edit: false },
      tasks: { view: true, edit: false },
      skus: { view: false, edit: false },
      orders: { view: false, edit: false },
      purchases: { view: false, edit: false },
      returns: { view: false, edit: false },
      suppliers: { view: false, edit: false },
      settlement: { view: false, edit: false }
    };
  }

  return {
    dashboard: { 
      view: enabledModules.dashboard !== false, 
      edit: enabledModules.dashboard !== false 
    },
    tasks: { 
      view: enabledModules.tasks !== false, 
      edit: enabledModules.tasks !== false 
    },
    skus: { 
      view: enabledModules.skus_products === true, 
      edit: enabledModules.skus_products === true 
    },
    orders: { 
      view: enabledModules.orders === true, 
      edit: enabledModules.orders === true 
    },
    purchases: { 
      view: enabledModules.purchases === true, 
      edit: enabledModules.purchases === true 
    },
    returns: { 
      view: enabledModules.returns === true, 
      edit: enabledModules.returns === true 
    },
    suppliers: { 
      view: enabledModules.suppliers === true, 
      edit: enabledModules.suppliers === true 
    },
    settlement: { 
      view: enabledModules.returns === true, 
      edit: enabledModules.returns === true 
    }
  };
}