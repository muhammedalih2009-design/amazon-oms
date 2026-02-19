import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // P0 SECURITY: Only app owner can manage allowed users
    if (user.email.toLowerCase() !== APP_OWNER_EMAIL.toLowerCase()) {
      return Response.json({ error: 'Forbidden: Owner only' }, { status: 403 });
    }

    const { action, email, name, status } = await req.json();

    if (!action) {
      return Response.json({ error: 'action required' }, { status: 400 });
    }

    // LIST
    if (action === 'list') {
      const allowedUsers = await base44.asServiceRole.entities.AllowedUser.filter({});
      return Response.json({ ok: true, users: allowedUsers });
    }

    // ADD
    if (action === 'add') {
      if (!email) {
        return Response.json({ error: 'email required' }, { status: 400 });
      }

      const normalizedEmail = email.toLowerCase().trim();

      // Check if already exists
      const existing = await base44.asServiceRole.entities.AllowedUser.filter({ email: normalizedEmail });
      if (existing.length > 0) {
        return Response.json({ error: 'User already in allowlist' }, { status: 400 });
      }

      const newUser = await base44.asServiceRole.entities.AllowedUser.create({
        email: normalizedEmail,
        name: name || '',
        status: 'active'
      });

      // Audit log
      await base44.asServiceRole.entities.AuditLog.create({
        workspace_id: null,
        user_id: user.id,
        user_email: user.email,
        action: 'allowed_user_added',
        entity_type: 'AllowedUser',
        entity_id: newUser.id,
        after_data: JSON.stringify({ email: normalizedEmail, name: name || '' }),
        metadata: { source: 'platform_admin' }
      });

      return Response.json({ ok: true, user: newUser });
    }

    // UPDATE STATUS
    if (action === 'update_status') {
      if (!email || !status) {
        return Response.json({ error: 'email and status required' }, { status: 400 });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const users = await base44.asServiceRole.entities.AllowedUser.filter({ email: normalizedEmail });

      if (users.length === 0) {
        return Response.json({ error: 'User not found' }, { status: 404 });
      }

      const updated = await base44.asServiceRole.entities.AllowedUser.update(users[0].id, { status });

      // Audit log
      await base44.asServiceRole.entities.AuditLog.create({
        workspace_id: null,
        user_id: user.id,
        user_email: user.email,
        action: status === 'active' ? 'allowed_user_enabled' : 'allowed_user_disabled',
        entity_type: 'AllowedUser',
        entity_id: users[0].id,
        before_data: JSON.stringify({ status: users[0].status }),
        after_data: JSON.stringify({ status }),
        metadata: { email: normalizedEmail }
      });

      return Response.json({ ok: true, user: updated });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Error managing allowed users:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});