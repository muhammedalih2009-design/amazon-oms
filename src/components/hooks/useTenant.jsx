import { useState, useEffect, createContext, useContext } from 'react';
import { base44 } from '@/api/base44Client';
import { AUTO_WORKSPACE_PROVISIONING } from '@/components/utils/constants';

const TenantContext = createContext(null);
const ACTIVE_WORKSPACE_KEY = 'active_workspace_id';

export function TenantProvider({ children }) {
  const [tenant, setTenant] = useState(null);
  const [membership, setMembership] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [allWorkspaces, setAllWorkspaces] = useState([]);
  const [userMemberships, setUserMemberships] = useState([]);
  const [workspaceModules, setWorkspaceModules] = useState([]);
  const [workspaceSettings, setWorkspaceSettings] = useState(null);

  useEffect(() => {
    loadTenantData();
  }, []);

  const loadTenantData = async () => {
    try {
      const currentUser = await base44.auth.me();

      // P0: Block deleted users from logging in
      if (currentUser.deleted === true || currentUser.account_status === 'deleted') {
        base44.auth.logout();
        alert('Account has been removed.');
        return;
      }

      setUser(currentUser);

      // Check if super admin (strict check)
      const isSuperAdmin = currentUser.role === 'admin' || currentUser.email === 'admin@amazonoms.com';

      // Load user's memberships
      const memberships = await base44.entities.Membership.filter({ user_email: currentUser.email });
      setUserMemberships(memberships);

      // Load workspaces based on role (P0 FIX: filter deleted)
      let workspaces = [];
      if (isSuperAdmin) {
        // Super admin sees ALL non-deleted workspaces
        const allWorkspaces = await base44.entities.Tenant.filter({});
        workspaces = allWorkspaces.filter(w => !w.deleted_at);
      } else if (memberships.length > 0) {
        // Regular user sees only their non-deleted workspaces
        const tenantIds = memberships.map(m => m.tenant_id);
        const allWorkspaces = await base44.entities.Tenant.filter({
          id: { $in: tenantIds }
        });
        workspaces = allWorkspaces.filter(w => !w.deleted_at);
      }
      setAllWorkspaces(workspaces);

      // Determine active workspace
      let activeWorkspaceId = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
      let activeTenant = null;
      let activeMembership = null;

      // Validate stored workspace
      if (activeWorkspaceId && workspaces.length > 0) {
        activeTenant = workspaces.find(t => t.id === activeWorkspaceId);
      }

      // SECURITY: Verify membership before fallback
      if (activeTenant) {
        const hasValidMembership = isSuperAdmin || 
          memberships.some(m => m.tenant_id === activeTenant.id);
        
        if (!hasValidMembership) {
          console.error('🚨 SECURITY: Blocked workspace access without membership', {
            workspace_id: activeTenant.id,
            user_email: currentUser.email,
            memberships: memberships.map(m => m.tenant_id)
          });
          
          // Block access
          activeTenant = null;
          localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
          
          // Audit log
          await base44.entities.AuditLog.create({
            workspace_id: null,
            actor_user_id: currentUser.id,
            action: 'workspace_access_blocked',
            target_type: 'Tenant',
            target_id: activeWorkspaceId,
            meta: { reason: 'no_membership' }
          }).catch(() => {});
        }
      }

      // Fallback to first workspace ONLY if membership exists
      if (!activeTenant && workspaces.length > 0) {
        // Find first workspace where user has membership
        for (const workspace of workspaces) {
          const hasAccess = isSuperAdmin || memberships.some(m => m.tenant_id === workspace.id);
          if (hasAccess) {
            activeTenant = workspace;
            localStorage.setItem(ACTIVE_WORKSPACE_KEY, activeTenant.id);
            break;
          }
        }
      }

      // P0 FIX: NEVER auto-create workspaces
      // If no workspaces, user sees "No workspaces assigned"
      if (!activeTenant) {
        // HARD BLOCK: Verify auto-provisioning is disabled
        if (AUTO_WORKSPACE_PROVISIONING === true) {
          console.error('CRITICAL: AUTO_WORKSPACE_PROVISIONING must be false!');
        }

        // Log blocked auto-creation attempt
        try {
          await base44.entities.AuditLog.create({
            workspace_id: null,
            user_id: currentUser.id,
            user_email: currentUser.email,
            action: 'workspace_auto_create_blocked',
            entity_type: 'Tenant',
            metadata: {
              reason: 'P0 security fix: auto-provisioning disabled globally',
              is_super_admin: isSuperAdmin,
              auto_provisioning_flag: AUTO_WORKSPACE_PROVISIONING
            }
          }).catch(() => {}); // Ignore audit log errors
        } catch (err) {
          console.error('Failed to log auto-create block:', err);
        }

        // User has no workspaces - leave state as null
        setTenant(null);
        setMembership(null);
        setSubscription(null);
      } else {
        // Load membership and subscription for active workspace
        activeMembership = memberships.find(m => m.tenant_id === activeTenant.id);
        
        // P0 FIX: REMOVED auto-membership creation
        // Super admin must use "Repair My Access" explicitly
        
        const subs = await base44.entities.Subscription.filter({ tenant_id: activeTenant.id });
        if (subs.length > 0) {
          setSubscription(subs[0]);
        }
      }

      setTenant(activeTenant);
      setMembership(activeMembership);

      // Load workspace modules and settings
      if (activeTenant) {
        try {
          const modules = await base44.entities.WorkspaceModule.filter({
            workspace_id: activeTenant.id
          });
          setWorkspaceModules(modules);
        } catch (error) {
          console.error('Error loading workspace modules:', error);
          setWorkspaceModules([]);
        }

        // Load workspace settings for currency
        try {
          const settings = await base44.entities.WorkspaceSettings.filter({
            workspace_id: activeTenant.id
          });
          setWorkspaceSettings(settings.length > 0 ? settings[0] : null);
        } catch (error) {
          console.error('Error loading workspace settings:', error);
          setWorkspaceSettings(null);
        }
      }
    } catch (error) {
      console.error('Error loading tenant data:', error);
    } finally {
      setLoading(false);
    }
  };

  const switchWorkspace = async (workspaceId) => {
    try {
      const newTenant = allWorkspaces.find(t => t.id === workspaceId);
      if (!newTenant) return;

      // SECURITY: Verify membership exists before switching
      const isSuperAdmin = user?.email?.toLowerCase() === 'muhammedalih.2009@gmail.com';
      let newMembership = userMemberships.find(m => m.tenant_id === workspaceId);
      
      if (!newMembership && !isSuperAdmin) {
        console.error('🚨 SECURITY: Cannot switch to workspace without membership', {
          workspace_id: workspaceId,
          user_email: user?.email
        });
        
        // Audit log
        await base44.entities.AuditLog.create({
          workspace_id: null,
          actor_user_id: user?.id,
          action: 'workspace_switch_blocked',
          target_type: 'Tenant',
          target_id: workspaceId,
          meta: { reason: 'no_membership' }
        }).catch(() => {});
        
        alert('Access denied: You do not have membership in this workspace');
        return;
      }

      setTenant(newTenant);
      localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId);
      setMembership(newMembership);

      const subs = await base44.entities.Subscription.filter({ tenant_id: workspaceId });
      setSubscription(subs.length > 0 ? subs[0] : null);

      // Reload page to refresh all data
      window.location.reload();
    } catch (error) {
      console.error('Failed to switch workspace:', error);
    }
  };

  const isActive = subscription?.status === 'active';
  const isOwner = membership?.role === 'owner';
  const isAdmin = membership?.role === 'owner' || membership?.role === 'admin';
  
  // SECURITY: Platform admin ONLY by exact email match
  const isPlatformAdmin = user?.email?.toLowerCase() === 'muhammedalih.2009@gmail.com';
  const isSuperAdmin = isPlatformAdmin;

  const permissions = membership?.permissions || {};

  // PERMISSIONS: Check module-level permissions
  const canViewPage = (moduleKey) => {
    if (isOwner) return true;
    return permissions[moduleKey]?.view === true;
  };

  const canEditPage = (moduleKey) => {
    if (isOwner) return true;
    return permissions[moduleKey]?.edit === true;
  };

  const isModuleEnabled = (moduleKey) => {
    // Platform admin can see all modules
    if (isPlatformAdmin) return true;
    
    // If no modules configured, assume all enabled
    if (workspaceModules.length === 0) return true;
    
    const module = workspaceModules.find(m => m.module_key === moduleKey);
    return module ? module.enabled : false;
  };

  const canAccessModule = (pageName) => {
    const moduleKey = PAGE_MODULE_MAP[pageName];
    if (!moduleKey) return true; // Unknown pages allowed by default
    return isModuleEnabled(moduleKey);
  };

  // Get currency from workspace settings or default to SAR
  const currency = workspaceSettings?.currency_code || 'SAR';
  const locale = user?.language === 'ar' ? 'ar-SA' : 'en-US';

  const value = {
    tenant,
    membership,
    subscription,
    user,
    loading,
    allWorkspaces,
    userMemberships,
    workspaceModules,
    workspaceSettings,
    currency,
    locale,
    switchWorkspace,
    isActive,
    isOwner,
    isAdmin,
    isSuperAdmin,
    isPlatformAdmin,
    tenantId: tenant?.id,
    permissions,
    canViewPage,
    canEditPage,
    isModuleEnabled,
    canAccessModule,
    refresh: loadTenantData
  };

  return (
    <TenantContext.Provider value={value}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant must be used within TenantProvider');
  }
  return context;
}

// Module key mapping for pages
export const PAGE_MODULE_MAP = {
  'Dashboard': 'dashboard',
  'Stores': 'stores',
  'SKUs': 'skus_products',
  'Orders': 'orders',
  'Profitability': 'profitability',
  'PurchaseRequests': 'purchase_requests',
  'Purchases': 'purchases',
  'Returns': 'returns',
  'Suppliers': 'suppliers',
  'Tasks': 'tasks',
  'Team': 'team'
};

export default useTenant;