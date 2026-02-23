import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PLATFORM_OWNER_EMAIL = "muhammedalih.2009@gmail.com";

function requireWorkspaceId(payload) {
  if (!payload.workspace_id && !payload.tenant_id) {
    throw new Error("workspace_id or tenant_id required in payload");
  }
  return payload.workspace_id || payload.tenant_id;
}

async function guardWorkspaceAccess(base44, user, workspace_id) {
  if (!workspace_id) {
    throw new Error("workspace_id required");
  }

  if (!user || !user.email) {
    throw new Error("Authentication required");
  }

  if (user.email.toLowerCase() === PLATFORM_OWNER_EMAIL.toLowerCase()) {
    return true;
  }

  const memberships = await base44.asServiceRole.entities.Membership.filter({
    user_email: user.email.toLowerCase(),
    tenant_id: workspace_id
  });

  if (!memberships || memberships.length === 0) {
    throw new Error("Cross-workspace access denied");
  }

  const membership = memberships[0];
  if (membership.deleted_at) {
    throw new Error("Access revoked");
  }

  return membership;
}

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
      telegram_chat_id_display: ws.telegram_chat_id || null
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});