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
      workspace_id
    };

    if (currency_code !== undefined) {
      updateData.currency_code = currency_code;
    }
    if (telegram_bot_token !== undefined) {
      updateData.telegram_bot_token = telegram_bot_token;
    }
    if (telegram_chat_id !== undefined) {
      updateData.telegram_chat_id = telegram_chat_id;
    }

    let result;

    try {
      if (existing.length > 0) {
        // Update existing
        result = await base44.asServiceRole.entities.WorkspaceSettings.update(
          existing[0].id,
          updateData
        );
      } else {
        // Create new
        result = await base44.asServiceRole.entities.WorkspaceSettings.create(updateData);
      }
    } catch (dbError) {
      // DB save failed - return error but don't retry
      console.error('[updateWorkspaceSettings] Database error:', dbError.message);
      throw dbError;
    }

    // SUCCESS: Always return after DB update succeeds
    // Never throw or call other APIs that could fail after this point
    return Response.json({
      ok: true,
      settings: result
    });
  } catch (error) {
    console.error('Error updating workspace settings:', error.message);
    return Response.json({ ok: false, error: error.message }, { status: 400 });
  }
});