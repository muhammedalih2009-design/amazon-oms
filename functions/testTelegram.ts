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

    if (settings.length === 0 || !settings[0].telegram_bot_token || !settings[0].telegram_chat_id) {
      return Response.json({
        success: false,
        error: 'Telegram not configured. Please set Bot Token and Chat ID first.'
      }, { status: 400 });
    }

    const { telegram_bot_token, telegram_chat_id } = settings[0];

    // Send test message
    const message = `✅ Test message from Amazon OMS\nWorkspace: ${workspace_id}\nTime: ${new Date().toISOString()}`;
    
    const telegramUrl = `https://api.telegram.org/bot${telegram_bot_token}/sendMessage`;
    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegram_chat_id,
        text: message,
        parse_mode: 'Markdown'
      })
    });

    const result = await response.json();

    // Audit log
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id,
      user_id: user.id,
      user_email: user.email,
      action: 'telegram_test_sent',
      entity_type: 'WorkspaceSettings',
      metadata: {
        success: result.ok,
        error: result.ok ? null : result.description
      }
    });

    if (!result.ok) {
      return Response.json({
        success: false,
        error: result.description || 'Failed to send message'
      }, { status: 400 });
    }

    return Response.json({
      success: true,
      message: 'Test message sent successfully'
    });
  } catch (error) {
    console.error('Error testing Telegram:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});