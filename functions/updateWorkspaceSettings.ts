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
    const { currency_code, telegram_bot_token, telegram_chat_id } = payload;

    // Get workspace_id from payload
    const workspace_id = payload.workspace_id || payload.tenant_id;
    if (!workspace_id) {
      return Response.json({ ok: false, error: 'workspace_id required in payload' }, { status: 400 });
    }

    // Verify user has access (platform owner or has membership)
    if (user.email.toLowerCase() !== PLATFORM_OWNER_EMAIL.toLowerCase()) {
      const memberships = await base44.asServiceRole.entities.Membership.filter({
        user_email: user.email.toLowerCase(),
        tenant_id: workspace_id
      });

      if (!memberships || memberships.length === 0) {
        console.error('🚨 SECURITY: Cross-workspace access denied', {
          user_email: user.email,
          workspace_id
        });
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

    // Validate currency if provided
    const validCurrencies = ['SAR', 'EGP', 'AED', 'USD', 'EUR', 'KWD', 'QAR', 'BHD', 'OMR'];
    if (currency_code && !validCurrencies.includes(currency_code)) {
      return Response.json({ ok: false, error: 'Invalid currency_code' }, { status: 400 });
    }

    // Validate Telegram token if provided
    if (telegram_bot_token && telegram_bot_token.trim()) {
      if (!telegram_bot_token.includes(':') || telegram_bot_token.length < 10) {
        return Response.json({ ok: false, error: 'Invalid Telegram bot token format' }, { status: 400 });
      }
    }

    // Validate Telegram chat_id if provided
    if (telegram_chat_id && telegram_chat_id.trim()) {
      const normalized = String(telegram_chat_id).trim();
      if (!normalized || isNaN(Number(normalized))) {
        return Response.json({ ok: false, error: 'Invalid Telegram chat ID' }, { status: 400 });
      }
    }

    // Check if settings exist
    const existing = await base44.asServiceRole.entities.WorkspaceSettings.filter({
      workspace_id
    });

    // Build update data
    const updateData = {
      workspace_id,
      updated_by_user_id: user.id
    };

    if (currency_code !== undefined) {
      updateData.currency_code = currency_code;
    }
    if (telegram_bot_token !== undefined && telegram_bot_token.trim()) {
      updateData.telegram_bot_token = telegram_bot_token.trim();
    }
    if (telegram_chat_id !== undefined && telegram_chat_id.trim()) {
      updateData.telegram_chat_id = telegram_chat_id.trim();
    }

    console.log(`[updateWorkspaceSettings] workspace_id=${workspace_id} user=${user.email}`);

    let result;

    if (existing.length > 0) {
      // Update existing
      const entityId = existing[0].id;
      console.log(`[updateWorkspaceSettings] Updating existing ID=${entityId}`);
      result = await base44.asServiceRole.entities.WorkspaceSettings.update(entityId, updateData);
    } else {
      // Create new
      console.log(`[updateWorkspaceSettings] Creating new WorkspaceSettings`);
      result = await base44.asServiceRole.entities.WorkspaceSettings.create(updateData);
    }

    console.log(`[updateWorkspaceSettings] SUCCESS workspace_id=${workspace_id}`);
    
    return Response.json({
      success: true,
      ok: true,
      settings: result
    });

  } catch (error) {
    console.error('[updateWorkspaceSettings] Error:', error);
    const statusCode = error.status || 500;
    const errorMessage = error.message || 'Failed to update workspace settings';
    return Response.json({ ok: false, error: errorMessage }, { status: statusCode });
  }
});