import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { guardWorkspaceAccess, requireWorkspaceId } from './helpers/guardWorkspaceAccess.js';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const { currency_code, telegram_bot_token, telegram_chat_id } = payload;

    // SECURITY: Require and validate workspace_id
    const workspace_id = requireWorkspaceId(payload);

    // SECURITY: Verify user has access and is admin/owner
    const membership = await guardWorkspaceAccess(base44, user, workspace_id);
    if (!['owner', 'admin'].includes(membership.role)) {
      return Response.json({ ok: false, error: 'Admin access required' }, { status: 403 });
    }

    // Validate currency if provided
    const validCurrencies = ['SAR', 'EGP', 'AED', 'USD', 'EUR', 'KWD', 'QAR', 'BHD', 'OMR'];
    if (currency_code && !validCurrencies.includes(currency_code)) {
      return Response.json({ ok: false, error: 'Invalid currency_code' }, { status: 400 });
    }

    // Validate Telegram token if provided
    if (telegram_bot_token && telegram_bot_token.trim()) {
      if (!telegram_bot_token.includes(':') || telegram_bot_token.length < 10) {
        return Response.json({ ok: false, error: 'Invalid Telegram bot token format. Token must contain ":" and be at least 10 characters.' }, { status: 400 });
      }
    }

    // Validate Telegram chat_id if provided
    if (telegram_chat_id && telegram_chat_id.trim()) {
      // Chat IDs can be negative or positive numbers, or strings
      const normalized = String(telegram_chat_id).trim();
      if (!normalized || isNaN(Number(normalized))) {
        return Response.json({ ok: false, error: 'Invalid Telegram chat ID. Must be a valid number (can be negative).' }, { status: 400 });
      }
    }

    // Check if settings exist
    const existing = await base44.asServiceRole.entities.WorkspaceSettings.filter({
      workspace_id
    });

    // Only include fields that are in the WorkspaceSettings schema
    const updateData = {
      workspace_id,
      actor_user_id: user.id, // Required for audit trail
      updated_by_user_id: user.id // Track who updated
    };

    if (currency_code !== undefined) {
      updateData.currency_code = currency_code;
    }
    // Only include token if it was explicitly provided by the frontend (new/changed)
    if (telegram_bot_token !== undefined && telegram_bot_token.trim()) {
      updateData.telegram_bot_token = telegram_bot_token.trim();
    }
    if (telegram_chat_id !== undefined && telegram_chat_id.trim()) {
      updateData.telegram_chat_id = telegram_chat_id.trim();
    }

    console.log(`[updateWorkspaceSettings] workspace_id=${workspace_id} user=${user.email} updating:`, {
      currency: updateData.currency_code || 'unchanged',
      token: updateData.telegram_bot_token ? `length=${updateData.telegram_bot_token.length}` : 'not provided',
      chatId: updateData.telegram_chat_id ? `first3chars=${updateData.telegram_chat_id.substring(0, 3)}...` : 'not provided'
    });

    let result;

    try {
      if (existing.length > 0) {
        // Update existing - exclude actor_user_id from update payload
        const entityId = existing[0].id;
        console.log(`[updateWorkspaceSettings] Updating existing ID=${entityId}`);
        
        // Remove actor_user_id for update (only needed on create)
        const { actor_user_id, ...updatePayload } = updateData;
        
        result = await base44.asServiceRole.entities.WorkspaceSettings.update(
          entityId,
          updatePayload
        );
      } else {
        // Create new - actor_user_id IS required on create
        console.log(`[updateWorkspaceSettings] Creating new WorkspaceSettings`);
        result = await base44.asServiceRole.entities.WorkspaceSettings.create(updateData);
      }
    } catch (dbError) {
      console.error('[updateWorkspaceSettings] Database error:', dbError.message, dbError.status || dbError.code);
      throw dbError;
    }

    // Create audit log (non-blocking - don't fail the request if this fails)
    try {
      await base44.asServiceRole.entities.AuditLog.create({
        workspace_id,
        actor_user_id: user.id,
        action: 'update_workspace_settings',
        target_type: 'WorkspaceSettings',
        target_id: result.id,
        meta: {
          currency_code: updateData.currency_code,
          telegram_updated: !!(updateData.telegram_bot_token || updateData.telegram_chat_id)
        }
      });
    } catch (auditError) {
      console.warn('[updateWorkspaceSettings] Audit log failed (non-blocking):', auditError.message);
    }

    // SUCCESS: Always return after DB update succeeds
    console.log(`[updateWorkspaceSettings] SUCCESS workspace_id=${workspace_id}`);
    return Response.json({
      ok: true,
      settings: result
    });
  } catch (error) {
    console.error('[updateWorkspaceSettings] Fatal error:', error.message);
    const statusCode = error.status || 400;
    const errorMessage = error.message || 'Failed to update workspace settings';
    return Response.json({ ok: false, error: errorMessage }, { status: statusCode });
  }
});