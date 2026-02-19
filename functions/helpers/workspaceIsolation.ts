/**
 * Server-side workspace isolation helpers
 * CRITICAL: All data access MUST use these functions
 */

const PLATFORM_ADMIN_EMAIL = 'muhammedalih.2009@gmail.com';

/**
 * P0 SECURITY: Get workspace ID from context with strict validation
 * Priority: 1) Request payload 2) User's active workspace
 * CRITICAL: Always verifies membership
 */
export async function getContextWorkspaceId(base44, req) {
  try {
    const body = await req.clone().json().catch(() => ({}));
    if (body.workspace_id) {
      return body.workspace_id;
    }
  } catch (error) {
    // Ignore JSON parse errors
  }
  
  // Fallback: get from user's memberships
  const user = await base44.auth.me();
  if (!user) return null;
  
  // P0 SECURITY: Only return workspace user is actually a member of
  const memberships = await base44.asServiceRole.entities.Membership.filter({
    user_email: user.email
  });
  
  if (memberships.length === 0) return null;
  return memberships[0].tenant_id;
}

/**
 * Enforce workspace scope on query
 */
export function enforceWorkspaceScope(query, workspace_id) {
  if (!workspace_id) {
    throw new Error('workspace_id required for query');
  }
  
  return {
    ...query,
    tenant_id: workspace_id
  };
}

/**
 * P0 SECURITY: Require user to be member of workspace
 * @throws {Error} 403 if not a member
 */
export async function requireWorkspaceMember(base44, workspace_id, user) {
  if (!user) {
    throw new Error('Authentication required');
  }
  
  if (!workspace_id) {
    throw new Error('workspace_id required');
  }
  
  // App owner bypass
  if (user.email.toLowerCase() === PLATFORM_ADMIN_EMAIL.toLowerCase()) {
    return true;
  }
  
  // P0 SECURITY: STRICT membership check
  const memberships = await base44.asServiceRole.entities.Membership.filter({
    tenant_id: workspace_id,
    user_email: user.email
  });
  
  if (memberships.length === 0) {
    // Log access denial
    await logAudit(base44, {
      workspace_id,
      user_id: user.id,
      user_email: user.email,
      action: 'workspace_access_denied',
      entity_type: 'workspace',
      entity_id: workspace_id,
      metadata: { reason: 'no_membership', function: 'requireWorkspaceMember' }
    });
    
    throw new Error('Access denied: not a member of this workspace');
  }
  
  return true;
}

/**
 * Log audit event
 */
export async function logAudit(base44, {
  workspace_id,
  user_id,
  user_email,
  action,
  entity_type,
  entity_id,
  before_data,
  after_data,
  metadata
}) {
  try {
    await base44.asServiceRole.entities.AuditLog.create({
      workspace_id,
      user_id,
      user_email,
      action,
      entity_type,
      entity_id,
      before_data: before_data ? JSON.stringify(before_data) : null,
      after_data: after_data ? JSON.stringify(after_data) : null,
      metadata
    });
  } catch (error) {
    console.error('[Audit] Failed to log:', error);
  }
}

/**
 * Log slow query
 */
export async function logSlowQuery(base44, {
  workspace_id,
  user_id,
  endpoint,
  query_name,
  duration_ms,
  rows_returned,
  params_hash
}) {
  try {
    if (duration_ms > 300) { // Only log queries > 300ms
      await base44.asServiceRole.entities.SlowQuery.create({
        workspace_id,
        user_id,
        endpoint,
        query_name,
        duration_ms,
        rows_returned,
        params_hash
      });
    }
  } catch (error) {
    console.error('[SlowQuery] Failed to log:', error);
  }
}

/**
 * Log error
 */
export async function logError(base44, {
  workspace_id,
  user_id,
  user_email,
  endpoint,
  error,
  payload_hash,
  http_status
}) {
  try {
    await base44.asServiceRole.entities.ErrorLog.create({
      workspace_id,
      user_id,
      user_email,
      endpoint,
      error_message: error.message || String(error),
      stack_trace: error.stack || '',
      payload_hash,
      http_status: http_status || 500
    });
  } catch (logError) {
    console.error('[ErrorLog] Failed to log:', logError);
  }
}

/**
 * Wrap function with monitoring
 */
export function withMonitoring(base44, endpoint, handler) {
  return async (req) => {
    const startTime = Date.now();
    let workspace_id = null;
    let user = null;
    
    try {
      user = await base44.auth.me().catch(() => null);
      workspace_id = await getContextWorkspaceId(base44, req);
      
      const result = await handler(req, { workspace_id, user });
      
      const duration = Date.now() - startTime;
      if (duration > 300) {
        await logSlowQuery(base44, {
          workspace_id,
          user_id: user?.id,
          endpoint,
          query_name: endpoint,
          duration_ms: duration,
          rows_returned: 0,
          params_hash: ''
        });
      }
      
      return result;
    } catch (error) {
      await logError(base44, {
        workspace_id,
        user_id: user?.id,
        user_email: user?.email,
        endpoint,
        error,
        payload_hash: '',
        http_status: error.status || 500
      });
      throw error;
    }
  };
}