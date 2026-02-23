import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { guardWorkspaceAccess, requireWorkspaceId } from './helpers/guardWorkspaceAccess.js';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ 
        configured: false, 
        hasToken: false, 
        hasChatId: false 
      }, { status: 200 });
    }

    const payload = await req.json();
    const workspace_id = requireWorkspaceId(payload);

    // Verify workspace access
    await guardWorkspaceAccess(base44, user, workspace_id);

    // Check WorkspaceSettings for this workspace
    let settings = [];
    try {
      settings = await base44.asServiceRole.entities.WorkspaceSettings.filter({
        workspace_id
      });
    } catch (err) {
      console.warn('[checkTelegramConfig] Query error:', err.message);
      return Response.json({ 
        configured: false, 
        hasToken: false, 
        hasChatId: false 
      }, { status: 200 });
    }

    if (!settings || settings.length === 0) {
      return Response.json({ 
        configured: false, 
        hasToken: false, 
        hasChatId: false 
      }, { status: 200 });
    }

    const ws = settings[0];
    const hasToken = !!(ws.telegram_bot_token && ws.telegram_bot_token.trim());
    const hasChatId = !!(ws.telegram_chat_id && ws.telegram_chat_id.trim());

    return Response.json({ 
      configured: hasToken && hasChatId,
      hasToken,
      hasChatId
    }, { status: 200 });
  } catch (error) {
    console.error('[checkTelegramConfig] Error:', error.message);
    return Response.json({ 
      configured: false, 
      hasToken: false, 
      hasChatId: false,
      error: error.message 
    }, { status: 200 }); // Return 200 with false flags instead of error
  }
});