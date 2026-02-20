import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  TrendingUp,
  ClipboardList,
  Truck,
  RotateCcw,
  Users,
  CheckSquare,
  Store,
  Settings
} from 'lucide-react';

/**
 * SINGLE SOURCE OF TRUTH FOR ALL WORKSPACE MODULES
 * 
 * Every module must be defined here with:
 * - moduleKey: unique identifier (matches WorkspaceModule.module_key)
 * - nameKey: translation key for display
 * - icon: Lucide icon component
 * - page: React Router page name (if navigable)
 * - hasPermissions: whether this module supports view/edit permissions
 * - adminOnly: whether only owners can manage access (e.g., team, settings)
 */

export const WORKSPACE_MODULES = [
  {
    moduleKey: 'dashboard',
    nameKey: 'dashboard',
    icon: LayoutDashboard,
    page: 'Dashboard',
    hasPermissions: true,
    adminOnly: false
  },
  {
    moduleKey: 'skus_products',
    nameKey: 'skus_products',
    icon: Package,
    page: 'SKUs',
    hasPermissions: true,
    adminOnly: false
  },
  {
    moduleKey: 'orders',
    nameKey: 'orders',
    icon: ShoppingCart,
    page: 'Orders',
    hasPermissions: true,
    adminOnly: false
  },
  {
    moduleKey: 'profitability',
    nameKey: 'profitability',
    icon: TrendingUp,
    page: 'Profitability',
    hasPermissions: true,
    adminOnly: false
  },
  {
    moduleKey: 'purchase_requests',
    nameKey: 'purchase_requests',
    icon: ClipboardList,
    page: 'PurchaseRequests',
    hasPermissions: true,
    adminOnly: false
  },
  {
    moduleKey: 'purchases',
    nameKey: 'purchases',
    icon: Truck,
    page: 'Purchases',
    hasPermissions: true,
    adminOnly: false
  },
  {
    moduleKey: 'returns',
    nameKey: 'returns',
    icon: RotateCcw,
    page: 'Returns',
    hasPermissions: true,
    adminOnly: false
  },
  {
    moduleKey: 'suppliers',
    nameKey: 'suppliers',
    icon: Users,
    page: 'SuppliersStores',
    hasPermissions: true,
    adminOnly: false
  },
  {
    moduleKey: 'tasks',
    nameKey: 'tasks',
    icon: CheckSquare,
    page: 'Tasks',
    hasPermissions: true,
    adminOnly: false
  },
  {
    moduleKey: 'team',
    nameKey: 'team',
    icon: Users,
    page: 'Team',
    hasPermissions: true,
    adminOnly: true // Only owners can grant team access
  },
  {
    moduleKey: 'backup_data',
    nameKey: 'backup_data',
    icon: Store,
    page: 'BackupData',
    hasPermissions: false, // System module, no granular permissions
    adminOnly: true
  },
  {
    moduleKey: 'settings',
    nameKey: 'settings',
    icon: Settings,
    page: 'Settings',
    hasPermissions: false, // System module, no granular permissions
    adminOnly: true
  }
];

/**
 * Get default permissions object for a new member
 * All modules with hasPermissions=true get { view: false, edit: false }
 */
export function getDefaultPermissions() {
  const permissions = {};
  
  WORKSPACE_MODULES.forEach(module => {
    if (module.hasPermissions) {
      permissions[module.moduleKey] = {
        view: module.moduleKey === 'dashboard', // Dashboard view enabled by default
        edit: false
      };
    }
  });
  
  return permissions;
}

/**
 * Get modules that support granular permissions (for permission modal)
 */
export function getPermissionModules() {
  return WORKSPACE_MODULES.filter(m => m.hasPermissions);
}

/**
 * Get navigable modules (for sidebar)
 */
export function getNavigableModules() {
  return WORKSPACE_MODULES.filter(m => m.page);
}

/**
 * Get module config by key
 */
export function getModuleByKey(moduleKey) {
  return WORKSPACE_MODULES.find(m => m.moduleKey === moduleKey);
}

/**
 * Check if user has permission for a module
 */
export function hasModulePermission(permissions, moduleKey, permissionType = 'view') {
  if (!permissions || !moduleKey) return false;
  
  const modulePerms = permissions[moduleKey];
  if (!modulePerms) return false;
  
  return modulePerms[permissionType] === true;
}