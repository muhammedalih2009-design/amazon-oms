import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { tenantId } = await req.json();

    // Fetch workspace settings to get Telegram config for THIS workspace
    const workspaceSettings = await base44.asServiceRole.entities.WorkspaceSettings.filter({
      tenant_id: tenantId
    });

    if (!workspaceSettings || workspaceSettings.length === 0) {
      return Response.json({ 
        ok: false, 
        error: 'Telegram not configured for this workspace. Go to Settings to add bot token and chat ID.' 
      }, { status: 400 });
    }

    const settings = workspaceSettings[0];
    const botToken = settings.telegram_bot_token;
    const chatId = settings.telegram_chat_id;

    if (!botToken || !chatId) {
      return Response.json({ 
        ok: false, 
        error: 'Telegram not configured. Please set bot token and chat ID in workspace settings.' 
      }, { status: 400 });
    }

    // Send test message to Telegram
    const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    console.log(`[Telegram Test] Testing connection to Telegram API...`);

    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '✅ Test message from Amazon OMS - Telegram connection successful!',
        parse_mode: 'HTML'
      })
    });

    const result = await response.json();

    // MANDATORY: Return detailed Telegram error, NOT generic 500
    if (!result.ok) {
      const telegramError = result.description || 'Unknown Telegram error';
      console.error(`[Telegram Test] Telegram API error: ${telegramError}`);
      
      return Response.json({ 
        ok: false, 
        error: telegramError,
        telegramCode: result.error_code || null
      }, { status: 400 });
    }

    console.log(`[Telegram Test] Connection test successful`);
    return Response.json({ ok: true, message: 'Telegram connection successful' });

  } catch (error) {
    console.error('[Telegram Test] Network error:', error);
    return Response.json({ 
      ok: false, 
      error: error.message || 'Network error: Unable to reach Telegram API',
      type: 'network_error'
    }, { status: 500 });
  }
});