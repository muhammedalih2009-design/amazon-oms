import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { workspace_id } = await req.json();

    if (!workspace_id) {
      return Response.json({ error: 'workspace_id required' }, { status: 400 });
    }

    // Get workspace settings
    const settings = await base44.asServiceRole.entities.WorkspaceSettings.filter({
      workspace_id
    });

    if (settings.length === 0) {
      return Response.json({
        currency_code: 'SAR',
        telegram_config_present: false,
        telegram_chat_id_masked: null
      });
    }

    const ws = settings[0];

    return Response.json({
      currency_code: ws.currency_code || 'SAR',
      telegram_config_present: !!(ws.telegram_bot_token && ws.telegram_chat_id),
      telegram_chat_id_masked: ws.telegram_chat_id ? ws.telegram_chat_id.slice(0, 3) + '****' : null
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});