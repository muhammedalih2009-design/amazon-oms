/**
 * Strict workspace isolation helper
 * Validates user has access to workspace with minimum role
 */

const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';

export async function requireWorkspaceAccess(base44, workspace_id, minimumRole = 'member') {
  // Get current user
  const user = await base44.auth.me();
  if (!user) {
    throw new Error('Unauthorized: No user session');
  }

  // App owner bypasses all checks
  if (user.email.toLowerCase() === APP_OWNER_EMAIL.toLowerCase()) {
    return { user, workspace: null, member: null, isOwner: true };
  }

  // Get PlatformUser
  const platformUsers = await base44.asServiceRole.entities.PlatformUser.filter({ 
    email: user.email,
    deleted_at: null
  });
  
  if (!platformUsers || platformUsers.length === 0) {
    throw new Error('Forbidden: User not registered in platform');
  }

  const platformUser = platformUsers[0];
  
  if (platformUser.status === 'disabled') {
    throw new Error('Forbidden: User account is disabled');
  }

  // Validate workspace exists and not deleted
  const workspace = await base44.asServiceRole.entities.Workspace.get(workspace_id);
  if (!workspace || workspace.deleted_at) {
    throw new Error('Forbidden: Workspace not found or deleted');
  }

  // Get workspace member
  const members = await base44.asServiceRole.entities.WorkspaceMember.filter({
    workspace_id,
    user_id: platformUser.id
  });

  if (!members || members.length === 0) {
    throw new Error('Forbidden: No access to this workspace');
  }

  const member = members[0];

  // Role hierarchy: owner > admin > member
  const roleHierarchy = { owner: 3, admin: 2, member: 1 };
  const userRoleLevel = roleHierarchy[member.role] || 0;
  const requiredRoleLevel = roleHierarchy[minimumRole] || 0;

  if (userRoleLevel < requiredRoleLevel) {
    throw new Error(`Forbidden: Requires ${minimumRole} role or higher`);
  }

  return { user, platformUser, workspace, member, isOwner: false };
}