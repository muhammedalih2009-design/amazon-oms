import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PLATFORM_OWNER_EMAIL = "muhammedalih.2009@gmail.com";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    
    // Get workspace_id
    const workspace_id = payload.workspace_id || payload.tenant_id;
    if (!workspace_id) {
      return Response.json({ ok: false, error: 'workspace_id required' }, { status: 400 });
    }

    // Verify user has access and is admin/owner
    if (user.email.toLowerCase() !== PLATFORM_OWNER_EMAIL.toLowerCase()) {
      const memberships = await base44.asServiceRole.entities.Membership.filter({
        user_email: user.email.toLowerCase(),
        tenant_id: workspace_id
      });

      if (!memberships || memberships.length === 0) {
        return Response.json({ ok: false, error: 'Access denied' }, { status: 403 });
      }

      const membership = memberships[0];
      if (membership.deleted_at) {
        return Response.json({ ok: false, error: 'Access revoked' }, { status: 403 });
      }

      if (!['owner', 'admin'].includes(membership.role)) {
        return Response.json({ ok: false, error: 'Admin access required' }, { status: 403 });
      }
    }

    // Get test token and chat_id from payload (NOT from database, to test NEW values before saving)
    const { test_token, test_chat_id } = payload;

    if (!test_token || !test_chat_id) {
      return Response.json({ 
        ok: false, 
        error: 'Bot token and chat ID required for testing' 
      }, { status: 400 });
    }

    // Validate token format
    if (!test_token.includes(':') || test_token.length < 10) {
      return Response.json({ 
        ok: false, 
        error: 'Invalid bot token format (must contain `:` and be at least 10 chars)' 
      }, { status: 400 });
    }

    console.log(`[Telegram Test] Testing connection with provided credentials for workspace ${workspace_id}...`);

    // Send test message to Telegram
    const telegramUrl = `https://api.telegram.org/bot${test_token}/sendMessage`;
    
    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: test_chat_id,
        text: '✅ Test message from Amazon OMS - Telegram connection successful!',
        parse_mode: 'HTML'
      })
    });

    const result = await response.json();

    // Return detailed Telegram error if failed
    if (!result.ok) {
      const telegramError = result.description || 'Unknown Telegram error';
      console.warn(`[Telegram Test] Telegram API error: ${telegramError}`);
      
      return Response.json({ 
        ok: false, 
        success: false,
        error: telegramError,
        error_code: result.error_code || null
      });
    }

    console.log(`[Telegram Test] Test successful for workspace ${workspace_id}`);
    return Response.json({ 
      ok: true, 
      success: true,
      message: 'Test message sent successfully' 
    });

  } catch (error) {
    console.error('[Telegram Test] Error:', error.message);
    return Response.json({ 
      ok: false,
      success: false,
      error: error.message || 'Network error: Unable to reach Telegram API',
      type: 'network_error'
    });
  }
});