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

      // Load workspaces based on role
      let workspaces = [];
      if (isSuperAdmin) {
        // Super admin sees ALL workspaces
        workspaces = await base44.entities.Tenant.filter({});
      } else if (memberships.length > 0) {
        // Regular user sees only their workspaces
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

      // Validate stored workspace
      if (activeWorkspaceId && workspaces.length > 0) {
        activeTenant = workspaces.find(t => t.id === activeWorkspaceId);
      }

      // Fallback to first workspace
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
        // Load membership and subscription for active workspace
        activeMembership = memberships.find(m => m.tenant_id === activeTenant.id);
        
        // SAFETY: If super admin and no membership exists, auto-create it
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
            // Update local state
            setUserMemberships([...memberships, activeMembership]);
          } catch (error) {
            console.error('Failed to auto-create super admin membership:', error);
          }
        }
        
        const subs = await base44.entities.Subscription.filter({ tenant_id: activeTenant.id });
        if (subs.length > 0) {
          setSubscription(subs[0]);
        }
      }

      setTenant(activeTenant);
      setMembership(activeMembership);
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

      let newMembership = userMemberships.find(m => m.tenant_id === workspaceId);
      
      // SAFETY: If super admin and no membership exists, auto-create it before switching
      const currentUser = user;
      const isSuperAdmin = currentUser?.role === 'admin' || currentUser?.email === 'admin@amazonoms.com';
      
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
          console.error('Failed to auto-create membership during switch:', error);
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

  const value = {
    tenant,
    membership,
    subscription,
    user,
    loading,
    allWorkspaces,
    userMemberships,
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