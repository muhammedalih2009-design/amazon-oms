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

      // Check if super admin (strict check)
      const isSuperAdmin = currentUser.role === 'admin' || currentUser.email === 'admin@amazonoms.com';

      // Load user's memberships
      const memberships = await base44.entities.Membership.filter({ user_email: currentUser.email });
      setUserMemberships(memberships);

      // P0 SECURITY: STRICT workspace list - only show workspaces with membership
      let workspaces = [];
      if (isSuperAdmin) {
        // App owner sees ALL workspaces
        workspaces = await base44.entities.Tenant.filter({});
      } else if (memberships.length > 0) {
        // CRITICAL: Regular users see ONLY workspaces they're members of
        const tenantIds = memberships.map(m => m.tenant_id);
        workspaces = await base44.entities.Tenant.filter({
          id: { $in: tenantIds }
        });
      }
      setAllWorkspaces(workspaces);

      // Determine active workspace
      let activeWorkspaceId = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
      let activeTenant = null;
      let activeMembership = null;

      // P0 SECURITY: Validate stored workspace has membership
      if (activeWorkspaceId && workspaces.length > 0) {
        activeTenant = workspaces.find(t => t.id === activeWorkspaceId);
        
        // CRITICAL: If stored workspace not in authorized list, clear it
        if (!activeTenant) {
          localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
          activeWorkspaceId = null;
        }
      }

      // Fallback to first authorized workspace
      if (!activeTenant && workspaces.length > 0) {
        activeTenant = workspaces[0];
        localStorage.setItem(ACTIVE_WORKSPACE_KEY, activeTenant.id);
      }

      // If no workspaces, create one
      if (!activeTenant) {
        const newTenant = await base44.entities.Tenant.create({
          name: `${currentUser.full_name || currentUser.email}'s Workspace`,
          slug: currentUser.email.split('@')[0] + '-' + Date.now()
        });

        const newMembership = await base44.entities.Membership.create({
          tenant_id: newTenant.id,
          user_id: currentUser.id,
          user_email: currentUser.email,
          role: 'owner',
          permissions: {
            dashboard: { view: true, edit: true },
            tasks: { view: true, edit: true },
            skus: { view: true, edit: true },
            orders: { view: true, edit: true },
            purchases: { view: true, edit: true },
            returns: { view: true, edit: true },
            suppliers: { view: true, edit: true }
          }
        });

        const trialEnd = new Date();
        trialEnd.setDate(trialEnd.getDate() + 14);
        const newSubscription = await base44.entities.Subscription.create({
          tenant_id: newTenant.id,
          plan: 'trial',
          status: 'active',
          current_period_end: trialEnd.toISOString().split('T')[0]
        });

        activeTenant = newTenant;
        activeMembership = newMembership;
        setSubscription(newSubscription);
        setAllWorkspaces([newTenant]);
        setUserMemberships([newMembership]);
        localStorage.setItem(ACTIVE_WORKSPACE_KEY, newTenant.id);
      } else {
        // P0 SECURITY: Load membership for active workspace
        activeMembership = memberships.find(m => m.tenant_id === activeTenant.id);
        
        // P0 SECURITY: If app owner and no membership, auto-create (safe exception)
        if (isSuperAdmin && !activeMembership) {
          try {
            activeMembership = await base44.entities.Membership.create({
              tenant_id: activeTenant.id,
              user_id: currentUser.id,
              user_email: currentUser.email,
              role: 'owner',
              permissions: {
                dashboard: { view: true, edit: true },
                tasks: { view: true, edit: true },
                skus: { view: true, edit: true },
                orders: { view: true, edit: true },
                purchases: { view: true, edit: true },
                returns: { view: true, edit: true },
                settlement: { view: true, edit: true },
                suppliers: { view: true, edit: true }
              }
            });
            setUserMemberships([...memberships, activeMembership]);
          } catch (error) {
            console.error('Failed to auto-create app owner membership:', error);
          }
        }
        
        // P0 SECURITY: If regular user has no membership, they shouldn't access this workspace
        if (!isSuperAdmin && !activeMembership) {
          console.error('SECURITY: User attempted to access workspace without membership');
          localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
          setTenant(null);
          setMembership(null);
          setSubscription(null);
          setLoading(false);
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
      // P0 SECURITY: Verify workspace is in authorized list
      const newTenant = allWorkspaces.find(t => t.id === workspaceId);
      if (!newTenant) {
        console.error('SECURITY: Attempted to switch to unauthorized workspace');
        return;
      }

      setTenant(newTenant);
      localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId);

      let newMembership = userMemberships.find(m => m.tenant_id === workspaceId);
      
      // P0 SECURITY: Only app owner can auto-create membership
      const currentUser = user;
      const isSuperAdmin = currentUser?.email?.toLowerCase() === 'muhammedalih.2009@gmail.com';
      
      if (isSuperAdmin && !newMembership) {
        try {
          newMembership = await base44.entities.Membership.create({
            tenant_id: workspaceId,
            user_id: currentUser.id,
            user_email: currentUser.email,
            role: 'owner',
            permissions: {
              dashboard: { view: true, edit: true },
              tasks: { view: true, edit: true },
              skus: { view: true, edit: true },
              orders: { view: true, edit: true },
              purchases: { view: true, edit: true },
              returns: { view: true, edit: true },
              settlement: { view: true, edit: true },
              suppliers: { view: true, edit: true }
            }
          });
        } catch (error) {
          console.error('Failed to auto-create app owner membership:', error);
        }
      }
      
      // P0 SECURITY: Regular users MUST have membership
      if (!isSuperAdmin && !newMembership) {
        console.error('SECURITY: Regular user cannot switch to workspace without membership');
        return;
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

  const isActive = subscription?.status === 'active';
  const isOwner = membership?.role === 'owner';
  const isAdmin = membership?.role === 'owner' || membership?.role === 'admin';
  const isSuperAdmin = user?.email === 'admin@amazonoms.com' || user?.role === 'admin';
  const isPlatformAdmin = isSuperAdmin;

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