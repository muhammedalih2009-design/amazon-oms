import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';
const AUTO_WORKSPACE_PROVISIONING = false; // P0 SECURITY: HARD BLOCK

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const currentUser = await base44.auth.me();

    // P0 HARD BLOCK: Verify this is explicit creation by owner, not auto-provisioning
    if (AUTO_WORKSPACE_PROVISIONING === true) {
      // Log critical security violation
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'workspace_creation_blocked_security_violation',
        entity_type: 'System',
        user_email: currentUser.email,
        metadata: {
          reason: 'AUTO_WORKSPACE_PROVISIONING flag was true - security violation',
          attempted_by: currentUser.email
        }
      });
      return Response.json({ 
        error: 'Security violation: Auto-provisioning must be disabled' 
      }, { status: 403 });
    }

    // P0 FIX: OWNER-ONLY workspace creation
    if (currentUser.email.toLowerCase() !== APP_OWNER_EMAIL.toLowerCase()) {
      // Log unauthorized attempt
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'workspace_creation_blocked_unauthorized',
        entity_type: 'Tenant',
        user_email: currentUser.email,
        metadata: {
          reason: 'Only app owner can create workspaces',
          attempted_by: currentUser.email
        }
      });
      return Response.json({ 
        error: 'Forbidden: Only app owner can create workspaces' 
      }, { status: 403 });
    }

    const payload = await req.json();
    const { workspace_name, slug, plan, enabled_modules } = payload;

    // Validation
    if (!workspace_name || !enabled_modules?.length) {
      return Response.json({ 
        error: 'Missing required fields: workspace_name, enabled_modules' 
      }, { status: 400 });
    }

    // 1. Create workspace
    const newTenant = await base44.asServiceRole.entities.Tenant.create({
      name: workspace_name,
      slug: slug || workspace_name.toLowerCase().replace(/\s+/g, '-'),
      settings: {}
    });

    // 2. Create subscription
    await base44.asServiceRole.entities.Subscription.create({
      tenant_id: newTenant.id,
      plan: plan || 'trial',
      status: 'active',
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    });

    // 3. Create workspace modules
    const modulesToCreate = enabled_modules.map(moduleKey => ({
      workspace_id: newTenant.id,
      module_key: moduleKey,
      enabled: true
    }));
    await base44.asServiceRole.entities.WorkspaceModule.bulkCreate(modulesToCreate);

    // 4. AUTO-ASSIGN PLATFORM ADMIN AS OWNER
    // Check if membership already exists (idempotent)
    const existingMembership = await base44.asServiceRole.entities.Membership.filter({
      tenant_id: newTenant.id,
      user_email: APP_OWNER_EMAIL.toLowerCase()
    });

    if (existingMembership.length === 0) {
      // Create full-access permissions for all modules
      const fullPermissions = {};
      enabled_modules.forEach(moduleKey => {
        fullPermissions[moduleKey] = { view: true, edit: true };
      });

      await base44.asServiceRole.entities.Membership.create({
        tenant_id: newTenant.id,
        user_id: currentUser.id,
        user_email: currentUser.email,
        role: 'owner',
        permissions: fullPermissions
      });
    }

    // 5. P0 MONITORING: Log workspace creation
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id: newTenant.id,
      user_id: currentUser.id,
      user_email: currentUser.email,
      action: 'workspace_created',
      entity_type: 'Tenant',
      entity_id: newTenant.id,
      after_data: JSON.stringify({
        name: workspace_name,
        slug: newTenant.slug,
        owner: APP_OWNER_EMAIL,
        modules: enabled_modules
      }),
      metadata: { 
        created_by: currentUser.email,
        modules_enabled: enabled_modules.length,
        auto_assigned_owner: true,
        timestamp: new Date().toISOString()
      }
    });

    return Response.json({
      ok: true,
      workspace_id: newTenant.id,
      workspace_name: workspace_name,
      owner_email: APP_OWNER_EMAIL
    });

  } catch (error) {
    console.error('Error creating workspace with admin:', error);
    return Response.json({ 
      error: error.message || 'Failed to create workspace' 
    }, { status: 500 });
  }
});