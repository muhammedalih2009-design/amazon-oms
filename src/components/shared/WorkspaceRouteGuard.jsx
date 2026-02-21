import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTenant } from '@/components/hooks/useTenant';
import { createPageUrl } from '@/utils';
import { PAGE_MODULE_MAP } from '@/components/hooks/useTenant';

/**
 * SECURITY: Route Guard for Workspace Pages
 * 
 * B) Blocks access if:
 * - User has no workspace membership
 * - Module is disabled for the workspace
 * 
 * Platform admin can bypass all checks.
 */

const SAFE_PAGES = ['NoAccess', 'AcceptInvite', 'ModuleDisabled', 'AcceptPlatformInvite'];
const ADMIN_PAGES = ['Admin', 'EmergencyRestore', 'RateLimitMonitor', 'Monitoring', 'OwnerLog'];
const ALWAYS_ACCESSIBLE = ['Dashboard', 'Settings']; // Core pages always accessible

export default function WorkspaceRouteGuard({ children, pageName }) {
  const { hasWorkspaceAccess, loading, isPlatformAdmin, canAccessModule } = useTenant();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Wait for loading to complete
    if (loading) return;

    // Allow platform admin to access all pages
    if (isPlatformAdmin) return;

    // Allow safe pages, admin-only pages, and always-accessible core pages
    if (SAFE_PAGES.includes(pageName) || ADMIN_PAGES.includes(pageName) || ALWAYS_ACCESSIBLE.includes(pageName)) return;

    // Block access if no workspace membership
    if (!hasWorkspaceAccess) {
      console.warn('🚨 SECURITY: Blocked workspace page access - no membership', {
        page: pageName,
        path: location.pathname
      });
      navigate(createPageUrl('NoAccess'), { replace: true });
      return;
    }

    // B) Block if module is disabled for this workspace
    const moduleKey = PAGE_MODULE_MAP[pageName];
    if (moduleKey && !canAccessModule(pageName)) {
      console.warn('🚨 MODULE GUARD: Blocked disabled module access', {
        page: pageName,
        module: moduleKey
      });
      navigate(createPageUrl('ModuleDisabled'), { replace: true });
      return;
    }
  }, [hasWorkspaceAccess, loading, isPlatformAdmin, pageName, navigate, location.pathname, canAccessModule]);

  // Show nothing while loading or if blocked
  if (loading) return null;
  if (!hasWorkspaceAccess && !isPlatformAdmin && !SAFE_PAGES.includes(pageName) && !ADMIN_PAGES.includes(pageName)) {
    return null;
  }

  return children;
}