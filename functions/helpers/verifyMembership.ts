/**
 * P0 SECURITY: Helper function to verify workspace membership server-side
 * Use this in ALL backend functions that access workspace data
 */

const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';

/**
 * Verify user has membership to workspace
 * @param {Object} base44 - SDK client
 * @param {Object} user - Current user
 * @param {string} workspaceId - Workspace ID to verify
 * @returns {Promise<Object>} { authorized: boolean, membership: Object|null, role: string|null }
 * @throws {Error} If not authorized
 */
export async function verifyWorkspaceMembership(base44, user, workspaceId) {
  if (!user) {
    throw new Error('User not authenticated');
  }

  if (!workspaceId) {
    throw new Error('workspace_id required');
  }

  // App owner has access to all workspaces
  const isAppOwner = user.email.toLowerCase() === APP_OWNER_EMAIL.toLowerCase();
  
  if (isAppOwner) {
    return {
      authorized: true,
      membership: null,
      role: 'owner',
      isAppOwner: true
    };
  }

  // STRICT CHECK: Verify membership exists
  const memberships = await base44.entities.Membership.filter({
    workspace_id: workspaceId,
    user_email: user.email
  });

  if (memberships.length === 0) {
    // Log access denial
    try {
      await base44.asServiceRole.entities.AuditLog.create({
        workspace_id: workspaceId,
        user_id: user.id,
        user_email: user.email,
        action: 'workspace_access_denied',
        entity_type: 'workspace',
        entity_id: workspaceId,
        metadata: {
          reason: 'no_membership',
          function: 'verifyWorkspaceMembership'
        }
      });
    } catch (logError) {
      console.error('Failed to log access denial:', logError);
    }

    throw new Error('Access denied: You are not a member of this workspace');
  }

  const membership = memberships[0];

  return {
    authorized: true,
    membership,
    role: membership.role,
    permissions: membership.permissions,
    isAppOwner: false
  };
}

/**
 * Get authorized workspace ID from request or throw
 * Use this at the start of backend functions
 */
export async function getAuthorizedWorkspaceId(base44, user, requestedWorkspaceId) {
  const verification = await verifyWorkspaceMembership(base44, user, requestedWorkspaceId);
  
  if (!verification.authorized) {
    throw new Error('Access denied: Not authorized for this workspace');
  }

  return requestedWorkspaceId;
}

/**
 * Middleware pattern for backend functions
 * Example usage:
 * 
 * Deno.serve(async (req) => {
 *   const base44 = createClientFromRequest(req);
 *   const user = await base44.auth.me();
 *   const { workspace_id } = await req.json();
 *   
 *   // Verify membership first
 *   await verifyWorkspaceMembership(base44, user, workspace_id);
 *   
 *   // Now safe to proceed with workspace operations
 *   const orders = await base44.entities.Order.filter({ tenant_id: workspace_id });
 *   ...
 * });
 */