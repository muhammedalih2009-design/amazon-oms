import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTenant } from '@/components/hooks/useTenant';
import { createPageUrl } from '@/utils';

/**
 * SECURITY: Route Guard for Workspace Pages
 * 
 * Blocks access to workspace pages if user has no workspace membership.
 * Platform admin (muhammedalih.2009@gmail.com) can bypass.
 */

const SAFE_PAGES = ['NoAccess', 'AcceptInvite'];

export default function WorkspaceRouteGuard({ children, pageName }) {
  const { hasWorkspaceAccess, loading, isPlatformAdmin } = useTenant();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Wait for loading to complete
    if (loading) return;

    // Allow platform admin to access all pages
    if (isPlatformAdmin) return;

    // Allow safe pages
    if (SAFE_PAGES.includes(pageName)) return;

    // Block access if no workspace membership
    if (!hasWorkspaceAccess) {
      console.warn('🚨 SECURITY: Blocked workspace page access - no membership', {
        page: pageName,
        path: location.pathname
      });
      navigate(createPageUrl('NoAccess'), { replace: true });
    }
  }, [hasWorkspaceAccess, loading, isPlatformAdmin, pageName, navigate, location.pathname]);

  // Show nothing while loading or if blocked
  if (loading) return null;
  if (!hasWorkspaceAccess && !isPlatformAdmin && !SAFE_PAGES.includes(pageName)) {
    return null;
  }

  return children;
}