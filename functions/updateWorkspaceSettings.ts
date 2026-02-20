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
    const { currency_code, telegram_bot_token, telegram_chat_id } = payload;

    // SECURITY: Require and validate workspace_id
    const workspace_id = requireWorkspaceId(payload);

    // SECURITY: Verify user has access and is admin/owner
    const membership = await guardWorkspaceAccess(base44, user, workspace_id);
    if (!['owner', 'admin'].includes(membership.role)) {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Validate currency if provided
    const validCurrencies = ['SAR', 'EGP', 'AED', 'USD', 'EUR', 'KWD', 'QAR', 'BHD', 'OMR'];
    if (currency_code && !validCurrencies.includes(currency_code)) {
      return Response.json({ error: 'Invalid currency_code' }, { status: 400 });
    }

    // Check if settings exist
    const existing = await base44.asServiceRole.entities.WorkspaceSettings.filter({
      workspace_id
    });

    const updateData = {
      workspace_id,
      updated_by_user_id: user.id
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
    const changedFields = [];

    if (existing.length > 0) {
      // Update existing
      const old = existing[0];
      
      if (currency_code && old.currency_code !== currency_code) {
        changedFields.push(`currency: ${old.currency_code} → ${currency_code}`);
      }
      if (telegram_bot_token !== undefined) {
        changedFields.push('telegram_bot_token: updated');
      }
      if (telegram_chat_id !== undefined && old.telegram_chat_id !== telegram_chat_id) {
        changedFields.push(`telegram_chat_id: updated`);
      }

      result = await base44.asServiceRole.entities.WorkspaceSettings.update(
        existing[0].id,
        updateData
      );
    } else {
      // Create new
      if (currency_code) changedFields.push(`currency: ${currency_code}`);
      if (telegram_bot_token) changedFields.push('telegram_bot_token: set');
      if (telegram_chat_id) changedFields.push('telegram_chat_id: set');

      result = await base44.asServiceRole.entities.WorkspaceSettings.create(updateData);
    }

    // Audit log
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id,
      user_id: user.id,
      user_email: user.email,
      action: 'workspace_settings_update',
      entity_type: 'WorkspaceSettings',
      entity_id: result.id,
      metadata: {
        changed_fields: changedFields
      }
    });

    return Response.json({
      success: true,
      settings: result
    });
  } catch (error) {
    console.error('Error updating workspace settings:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});