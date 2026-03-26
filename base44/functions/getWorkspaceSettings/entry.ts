import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PLATFORM_OWNER_EMAIL = "muhammedalih.2009@gmail.com";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();

    // Get workspace_id
    const workspace_id = payload.workspace_id || payload.tenant_id;
    if (!workspace_id) {
      return Response.json({ error: 'workspace_id required' }, { status: 400 });
    }

    // Verify user has access (platform owner or has membership)
    if (user.email.toLowerCase() !== PLATFORM_OWNER_EMAIL.toLowerCase()) {
      const memberships = await base44.asServiceRole.entities.Membership.filter({
        user_email: user.email.toLowerCase(),
        tenant_id: workspace_id
      });

      if (!memberships || memberships.length === 0) {
        return Response.json({ error: 'Access denied' }, { status: 403 });
      }

      const membership = memberships[0];
      if (membership.deleted_at) {
        return Response.json({ error: 'Access revoked' }, { status: 403 });
      }
    }

    // Get workspace settings
    const settings = await base44.asServiceRole.entities.WorkspaceSettings.filter({
      workspace_id
    });

    if (settings.length === 0) {
      return Response.json({
        currency_code: 'SAR',
        telegram_config_present: false,
        telegram_chat_id_display: null
      });
    }

    const ws = settings[0];

    return Response.json({
      currency_code: ws.currency_code || 'SAR',
      telegram_config_present: !!(ws.telegram_bot_token && ws.telegram_chat_id),
      telegram_chat_id_display: ws.telegram_chat_id || null
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});