import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const currentUser = await base44.auth.me();

    // P0 FIX: OWNER-ONLY workspace creation
    if (currentUser.email.toLowerCase() !== APP_OWNER_EMAIL.toLowerCase()) {
      return Response.json({ 
        error: 'Forbidden: Only app owner can create workspaces' 
      }, { status: 403 });
    }

    const payload = await req.json();
    const { workspace_name, slug, plan, enabled_modules, admin_email, admin_role } = payload;

    // Validation
    if (!workspace_name || !admin_email || !admin_role || !enabled_modules?.length) {
      return Response.json({ 
        error: 'Missing required fields: workspace_name, admin_email, admin_role, enabled_modules' 
      }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(admin_email)) {
      return Response.json({ error: 'Invalid email format' }, { status: 400 });
    }

    if (!['owner', 'admin'].includes(admin_role)) {
      return Response.json({ error: 'Invalid role: must be owner or admin' }, { status: 400 });
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

    // P0 SECURITY: Create membership ONLY for THIS workspace
    // 4. Always add platform admin (current user) as OWNER
    await base44.asServiceRole.entities.Membership.create({
      tenant_id: newTenant.id,
      user_id: currentUser.id,
      user_email: currentUser.email,
      role: 'owner',
      permissions: {
        dashboard: { view: true, edit: true },
        tasks: { view: true, edit: true },
        skus: { view: true, edit: true },
        orders: { view: true, edit: true },
        purchases: { view: true, edit: true },
        returns: { view: true, edit: true },
        suppliers: { view: true, edit: true }
      }
    });

    // 5. Handle admin assignment - ONLY for THIS workspace
    const normalizedEmail = admin_email.toLowerCase().trim();
    let mode = 'invite_created';
    let inviteToken = null;

    // Check if user exists
    const existingUsers = await base44.asServiceRole.entities.User.filter({ email: normalizedEmail });
    
    if (existingUsers.length > 0) {
      // User exists - add as member ONLY to THIS workspace (if not already the platform admin)
      const targetUser = existingUsers[0];
      if (targetUser.email !== currentUser.email) {
        // P0 SECURITY: Create membership ONLY for newTenant.id
        await base44.asServiceRole.entities.Membership.create({
          tenant_id: newTenant.id,
          user_id: targetUser.id,
          user_email: targetUser.email,
          role: admin_role,
          permissions: {
            dashboard: { view: true, edit: true },
            tasks: { view: true, edit: true },
            skus: { view: true, edit: true },
            orders: { view: true, edit: true },
            purchases: { view: true, edit: true },
            returns: { view: true, edit: true },
            suppliers: { view: true, edit: true }
          }
        });
      }
      mode = 'member_added';

      // Audit log
      await base44.asServiceRole.entities.AuditLog.create({
        workspace_id: newTenant.id,
        user_id: currentUser.id,
        user_email: currentUser.email,
        action: 'create',
        entity_type: 'Membership',
        after_data: JSON.stringify({ email: normalizedEmail, role: admin_role }),
        metadata: { context: 'workspace_admin_assigned' }
      });
    } else {
      // User does NOT exist - create invite
      let inviteToken;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      // Check for duplicate pending invite
      const existingInvites = await base44.asServiceRole.entities.WorkspaceInvite.filter({
        workspace_id: newTenant.id,
        invited_email: normalizedEmail,
        status: 'pending'
      });

      if (existingInvites.length > 0) {
        // Reuse existing invite token
        inviteToken = existingInvites[0].token;
      } else {
        // Create new invite
        inviteToken = crypto.randomUUID();
        await base44.asServiceRole.entities.WorkspaceInvite.create({
          workspace_id: newTenant.id,
          invited_email: normalizedEmail,
          role: admin_role,
          token: inviteToken,
          status: 'pending',
          invited_by: currentUser.email,
          expires_at: expiresAt.toISOString()
        });
      }

      // Audit log
      await base44.asServiceRole.entities.AuditLog.create({
        workspace_id: newTenant.id,
        user_id: currentUser.id,
        user_email: currentUser.email,
        action: 'create',
        entity_type: 'WorkspaceInvite',
        after_data: JSON.stringify({ email: normalizedEmail, role: admin_role }),
        metadata: { context: 'workspace_admin_invited' }
      });
    }

    // 6. Final audit log for workspace creation
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id: newTenant.id,
      user_id: currentUser.id,
      user_email: currentUser.email,
      action: 'create',
      entity_type: 'Workspace',
      after_data: JSON.stringify({
        name: workspace_name,
        admin_email: normalizedEmail,
        admin_role: admin_role,
        modules: enabled_modules
      }),
      metadata: { 
        modules_enabled: enabled_modules.length,
        admin_assignment_mode: mode
      }
    });

    return Response.json({
      ok: true,
      workspace_id: newTenant.id,
      workspace_name: workspace_name,
      mode: mode,
      invite_token: inviteToken,
      admin_email: normalizedEmail
    });

  } catch (error) {
    console.error('Error creating workspace with admin:', error);
    return Response.json({ 
      error: error.message || 'Failed to create workspace' 
    }, { status: 500 });
  }
});