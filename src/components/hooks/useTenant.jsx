import { useState, useEffect, createContext, useContext } from 'react';
import { base44 } from '@/api/base44Client';

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
      setUser(currentUser);

      // P0 SECURITY: Check if user is allowed to access the app
      const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';
      const isOwner = currentUser.email.toLowerCase() === APP_OWNER_EMAIL.toLowerCase();

      if (!isOwner) {
        // Non-owner must be in AllowedUser table with active status
        const accessValidation = await base44.functions.invoke('validateUserAccess', {});
        if (!accessValidation.data.allowed) {
          // Block access
          setLoading(false);
          setAllWorkspaces([]);
          setUserMemberships([]);
          alert(accessValidation.data.reason || 'Access denied. Contact the owner.');
          return;
        }
      }

      // Load user's memberships
      const memberships = await base44.entities.Membership.filter({ user_email: currentUser.email });
      setUserMemberships(memberships);

      // P0 SECURITY: Load workspaces based on strict isolation
      let workspaces = [];
      if (isOwner) {
        // Owner sees ALL non-deleted workspaces
        const allTenants = await base44.entities.Tenant.filter({});
        workspaces = allTenants.filter(t => !t.deleted_at);
      } else if (memberships.length > 0) {
        // Regular user sees ONLY workspaces they have membership for (non-deleted)
        const tenantIds = memberships.map(m => m.tenant_id);
        const allTenants = await base44.entities.Tenant.filter({
          id: { $in: tenantIds }
        });
        workspaces = allTenants.filter(t => !t.deleted_at);
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

      // Fallback to first workspace
      if (!activeTenant && workspaces.length > 0) {
        activeTenant = workspaces[0];
        localStorage.setItem(ACTIVE_WORKSPACE_KEY, activeTenant.id);
      }

      // P0 SECURITY: NO AUTO-WORKSPACE CREATION
      // If no workspaces, show empty state (owner must create via Platform Admin)
      if (!activeTenant) {
        setLoading(false);
        return;
      } else {
        // P0 SECURITY: Load membership for active workspace - NO AUTO-CREATE
        activeMembership = memberships.find(m => m.tenant_id === activeTenant.id);
        
        // If no membership, block access (even for owner - must repair via button)
        if (!activeMembership && !isOwner) {
          console.error('No membership for workspace', activeTenant.id);
          setLoading(false);
          setAllWorkspaces([]);
          return;
        }
        
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

      setTenant(newTenant);
      localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId);

      // P0 SECURITY: NO AUTO-CREATE - user must have membership
      const newMembership = userMemberships.find(m => m.tenant_id === workspaceId);
      
      if (!newMembership) {
        const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';
        if (user?.email.toLowerCase() !== APP_OWNER_EMAIL.toLowerCase()) {
          alert('You do not have access to this workspace');
          return;
        }
      }
      
      setMembership(newMembership);

      const subs = await base44.entities.Subscription.filter({ tenant_id: workspaceId });
      setSubscription(subs.length > 0 ? subs[0] : null);

      // Reload page to refresh all data
      window.location.reload();
    } catch (error) {
      console.error('Failed to switch workspace:', error);
    }
  };

  const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';
  const isActive = subscription?.status === 'active';
  const isOwner = membership?.role === 'owner';
  const isAdmin = membership?.role === 'owner' || membership?.role === 'admin';
  const isPlatformOwner = user?.email.toLowerCase() === APP_OWNER_EMAIL.toLowerCase();
  const isPlatformAdmin = isPlatformOwner;

  const permissions = membership?.permissions || {};

  const canViewPage = (pageKey) => {
    if (isOwner) return true;
    return permissions[pageKey]?.view === true;
  };

  const canEditPage = (pageKey) => {
    if (isOwner) return true;
    return permissions[pageKey]?.edit === true;
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