/**
 * SECURITY: Strict Workspace Isolation Guard
 * 
 * This function enforces that users can ONLY access workspaces they have membership in.
 * NO fallbacks, NO auto-assignment, NO role-based overrides.
 * 
 * ONLY exception: Platform owner email === "muhammedalih.2009@gmail.com"
 */

const PLATFORM_OWNER_EMAIL = "muhammedalih.2009@gmail.com";

export async function guardWorkspaceAccess(base44, user, workspace_id) {
  // Validate inputs
  if (!workspace_id) {
    console.error('🚨 SECURITY: workspace_id required but not provided', {
      user_email: user?.email
    });
    throw new Error("workspace_id required");
  }

  if (!user || !user.email) {
    console.error('🚨 SECURITY: User not authenticated');
    throw new Error("Authentication required");
  }

  // Strict platform admin override - ONLY owner email
  if (user.email.toLowerCase() === PLATFORM_OWNER_EMAIL.toLowerCase()) {
    console.log('✅ Platform owner override granted:', user.email);
    return true;
  }

  // Verify membership exists
  const memberships = await base44.asServiceRole.entities.Membership.filter({
    user_email: user.email.toLowerCase(),
    tenant_id: workspace_id
  });

  if (!memberships || memberships.length === 0) {
    console.error('🚨 SECURITY: Cross-workspace access denied', {
      user_email: user.email,
      workspace_id,
      attempted_at: new Date().toISOString()
    });

    // Log security event
    try {
      await base44.asServiceRole.entities.AuditLog.create({
        workspace_id: null,
        actor_user_id: user.id,
        action: 'workspace_access_blocked',
        target_type: 'Tenant',
        target_id: workspace_id,
        meta: {
          reason: 'no_membership',
          user_email: user.email,
          workspace_id
        }
      });
    } catch (auditError) {
      console.error('Failed to log security event:', auditError);
    }

    throw new Error("Cross-workspace access denied");
  }

  // Check if membership is deleted/inactive
  const membership = memberships[0];
  if (membership.deleted_at) {
    console.error('🚨 SECURITY: Membership is deleted', {
      user_email: user.email,
      workspace_id
    });
    throw new Error("Access revoked");
  }

  console.log('✅ Workspace access granted:', {
    user_email: user.email,
    workspace_id,
    role: membership.role
  });

  return membership;
}

/**
 * Helper: Validate workspace_id is present in request
 */
export function requireWorkspaceId(payload) {
  if (!payload.workspace_id && !payload.tenant_id) {
    throw new Error("workspace_id or tenant_id required in payload");
  }
  return payload.workspace_id || payload.tenant_id;
}

/**
 * Helper: Check if user is platform owner
 */
export function isPlatformOwner(user) {
  return user?.email?.toLowerCase() === PLATFORM_OWNER_EMAIL.toLowerCase();
}