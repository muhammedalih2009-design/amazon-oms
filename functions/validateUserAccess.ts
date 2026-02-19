import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ allowed: false, reason: 'Not authenticated' }, { status: 401 });
    }

    // P0 SECURITY: Owner always allowed
    if (user.email.toLowerCase() === APP_OWNER_EMAIL.toLowerCase()) {
      return Response.json({ allowed: true, is_owner: true });
    }

    // Check if user is in AllowedUser table with active status
    const allowedUsers = await base44.asServiceRole.entities.AllowedUser.filter({
      email: user.email.toLowerCase()
    });

    if (allowedUsers.length === 0) {
      // User not in allowlist
      await base44.asServiceRole.entities.AuditLog.create({
        workspace_id: null,
        user_id: user.id,
        user_email: user.email,
        action: 'access_denied',
        entity_type: 'AllowedUser',
        metadata: { reason: 'not_in_allowlist' }
      });

      return Response.json({ 
        allowed: false, 
        reason: 'Access not granted. Contact the owner.' 
      }, { status: 403 });
    }

    const allowedUser = allowedUsers[0];

    if (allowedUser.status === 'disabled') {
      // User disabled
      await base44.asServiceRole.entities.AuditLog.create({
        workspace_id: null,
        user_id: user.id,
        user_email: user.email,
        action: 'access_denied',
        entity_type: 'AllowedUser',
        metadata: { reason: 'user_disabled' }
      });

      return Response.json({ 
        allowed: false, 
        reason: 'Account disabled. Contact the owner.' 
      }, { status: 403 });
    }

    return Response.json({ allowed: true, is_owner: false });
  } catch (error) {
    console.error('Error validating user access:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});