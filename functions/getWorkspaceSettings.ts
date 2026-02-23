import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { guardWorkspaceAccess, requireWorkspaceId } from './helpers/guardWorkspaceAccess.js';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();

    // SECURITY: Require and validate workspace_id
    const workspace_id = requireWorkspaceId(payload);

    // SECURITY: Verify user has access to this workspace
    await guardWorkspaceAccess(base44, user, workspace_id);

    // Get workspace settings
    let settings;
    try {
      settings = await base44.asServiceRole.entities.WorkspaceSettings.filter({
        workspace_id
      });
    } catch (err) {
      console.warn('[getWorkspaceSettings] Query error:', err.message);
      // Return defaults if query fails
      return Response.json({
        currency_code: 'SAR',
        telegram_config_present: false,
        telegram_chat_id_display: null
      });
    }

    if (!settings || settings.length === 0) {
      return Response.json({
        currency_code: 'SAR',
        telegram_config_present: false,
        telegram_chat_id_display: null
      });
    }

    const ws = settings[0];

    const response = {
      currency_code: ws.currency_code || 'SAR',
      telegram_config_present: !!(ws.telegram_bot_token && ws.telegram_chat_id),
      telegram_chat_id_display: ws.telegram_chat_id || null
    };

    // Optionally include token if requested (for testing purposes only)
    if (payload.include_token === true) {
      response.telegram_bot_token = ws.telegram_bot_token || null;
    }

    return Response.json(response);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});