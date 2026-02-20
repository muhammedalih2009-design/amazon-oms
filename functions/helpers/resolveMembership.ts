/**
 * CRITICAL: Unified membership resolver
 * Handles email-based invites + user_id backfilling
 */

const PLATFORM_ADMIN_EMAIL = 'muhammedalih.2009@gmail.com';

/**
 * Resolve membership for a user in a workspace
 * Handles both user_id and email-based lookups
 * Auto-backfills user_id if missing
 * 
 * @returns {Object|null} membership object or null if no access
 */
export async function resolveMembership(base44, user, workspace_id) {
  if (!user || !workspace_id) {
    return null;
  }

  // Platform admin override - always has access
  if (user.email.toLowerCase() === PLATFORM_ADMIN_EMAIL.toLowerCase()) {
    // Return synthetic admin membership for platform admin
    return {
      id: 'platform_admin_override',
      tenant_id: workspace_id,
      user_id: user.id,
      user_email: user.email,
      role: 'owner',
      permissions: getAllPermissions(),
      is_platform_admin: true
    };
  }

  // 1. Try lookup by user_id (fastest, most stable)
  let memberships = await base44.asServiceRole.entities.Membership.filter({
    tenant_id: workspace_id,
    user_id: user.id
  });

  if (memberships.length > 0) {
    return memberships[0];
  }

  // 2. Try lookup by email (invited by email before user logged in)
  memberships = await base44.asServiceRole.entities.Membership.filter({
    tenant_id: workspace_id,
    user_email: user.email.toLowerCase()
  });

  if (memberships.length > 0) {
    const membership = memberships[0];
    
    // CRITICAL: Backfill user_id for stability
    if (!membership.user_id || membership.user_id !== user.id) {
      console.log(`[resolveMembership] Backfilling user_id for ${user.email} in workspace ${workspace_id}`);
      
      try {
        await base44.asServiceRole.entities.Membership.update(membership.id, {
          user_id: user.id
        });
        
        // Return updated membership
        return {
          ...membership,
          user_id: user.id
        };
      } catch (error) {
        console.error('[resolveMembership] Failed to backfill user_id:', error);
        // Continue with existing membership even if update failed
      }
    }
    
    return membership;
  }

  // No membership found
  return null;
}

/**
 * Check if user has permission for a module action
 */
export function hasModulePermission(membership, moduleKey, permissionType = 'view') {
  if (!membership || !moduleKey) return false;
  
  // Platform admin override
  if (membership.is_platform_admin) return true;
  
  // Owner has all permissions
  if (membership.role === 'owner') return true;
  
  const permissions = membership.permissions || {};
  const modulePerms = permissions[moduleKey];
  
  if (!modulePerms) return false;
  
  return modulePerms[permissionType] === true;
}

/**
 * Require edit permission for a module
 * @throws {Error} if no edit permission
 */
export function requireEditPermission(membership, moduleKey) {
  if (!hasModulePermission(membership, moduleKey, 'edit')) {
    throw new Error(`edit_not_allowed: You do not have edit permission for ${moduleKey}`);
  }
}

/**
 * Get all permissions (for platform admin override)
 */
function getAllPermissions() {
  return {
    dashboard: { view: true, edit: true },
    tasks: { view: true, edit: true },
    skus_products: { view: true, edit: true },
    orders: { view: true, edit: true },
    profitability: { view: true, edit: true },
    purchase_requests: { view: true, edit: true },
    purchases: { view: true, edit: true },
    returns: { view: true, edit: true },
    suppliers: { view: true, edit: true },
    team: { view: true, edit: true },
    backup_data: { view: true, edit: true },
    settings: { view: true, edit: true },
    member_mgmt: {
      can_add_members: true,
      can_remove_members: true
    }
  };
}