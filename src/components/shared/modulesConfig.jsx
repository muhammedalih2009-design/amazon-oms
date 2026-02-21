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
  Settings,
  UsersRound,
  Database
} from 'lucide-react';

/**
 * ============================================================
 * SINGLE SOURCE OF TRUTH FOR ALL WORKSPACE MODULES
 * ============================================================
 * 
 * RULES:
 * 1. This is the ONLY place to define workspace modules
 * 2. Sidebar navigation is built EXCLUSIVELY from this config
 * 3. Permission checks are driven by this config
 * 4. NO hardcoded module lists anywhere else
 * 
 * Each module has:
 * - key: unique identifier (matches Membership.permissions[key])
 * - label: display name (English)
 * - route: page route (for navigation)
 * - icon: Lucide icon component
 * - group: category for sidebar grouping
 * - hasPermissions: whether this module has view/edit permissions
 * - adminOnly: whether only owners can see this module
 */

export const WORKSPACE_MODULES = [
  // A) REORDERED PER SPEC: Dashboard → SKUs → Suppliers → Purchase Requests → Purchases → Orders
  {
    key: "dashboard",
    label: "Dashboard",
    route: "Dashboard",
    icon: LayoutDashboard,
    group: "General",
    hasPermissions: true,
    adminOnly: false
  },
  {
    key: "skus_products",
    label: "SKUs / Products",
    route: "SKUs",
    icon: Package,
    group: "Inventory",
    hasPermissions: true,
    adminOnly: false
  },
  {
    key: "suppliers",
    label: "Suppliers & Stores",
    route: "SuppliersStores",
    icon: Store,
    group: "Inventory",
    hasPermissions: true,
    adminOnly: false
  },
  {
    key: "purchase_requests",
    label: "Purchase Requests",
    route: "PurchaseRequests",
    icon: ClipboardList,
    group: "Inventory",
    hasPermissions: true,
    adminOnly: false
  },
  {
    key: "purchases",
    label: "Purchases",
    route: "Purchases",
    icon: Truck,
    group: "Inventory",
    hasPermissions: true,
    adminOnly: false
  },
  {
    key: "orders",
    label: "Orders",
    route: "Orders",
    icon: ShoppingCart,
    group: "Operations",
    hasPermissions: true,
    adminOnly: false
  },
  
  // Remaining pages in original order
  {
    key: "returns",
    label: "Returns",
    route: "Returns",
    icon: RotateCcw,
    group: "Operations",
    hasPermissions: true,
    adminOnly: false
  },
  {
    key: "profitability",
    label: "Profitability",
    route: "Profitability",
    icon: TrendingUp,
    group: "Finance",
    hasPermissions: true,
    adminOnly: false
  },
  {
    key: "tasks",
    label: "Tasks",
    route: "Tasks",
    icon: CheckSquare,
    group: "Task Mgmt",
    hasPermissions: true,
    adminOnly: false
  },
  {
    key: "team",
    label: "Team",
    route: "Team",
    icon: UsersRound,
    group: "Admin",
    hasPermissions: true,
    adminOnly: true
  },
  {
    key: "backup_data",
    label: "Backup Data",
    route: "BackupData",
    icon: Database,
    group: "Admin",
    hasPermissions: true,
    adminOnly: true
  },
  {
    key: "settings",
    label: "Settings",
    route: "Settings",
    icon: Settings,
    group: "Admin",
    hasPermissions: true,
    adminOnly: true
  }
];

/**
 * ============================================================
 * HELPER FUNCTIONS
 * ============================================================
 */

/**
 * Get default permissions object for a new member
 * All modules with hasPermissions=true get { view: false, edit: false }
 */
export function getDefaultPermissions() {
  const permissions = {};
  
  WORKSPACE_MODULES.forEach(module => {
    if (module.hasPermissions) {
      permissions[module.key] = {
        view: module.key === 'dashboard', // Dashboard view enabled by default
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
 * Get navigable modules (for sidebar rendering)
 */
export function getNavigableModules() {
  return WORKSPACE_MODULES.filter(m => m.route);
}

/**
 * Get module config by key
 */
export function getModuleByKey(moduleKey) {
  return WORKSPACE_MODULES.find(m => m.key === moduleKey);
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

/**
 * Get sidebar nav items filtered by user permissions
 * SECURITY: Returns empty array if noAccess=true
 */
export function getSidebarItems(permissions, isOwner, noAccess, isPlatformAdmin) {
  // HARD BLOCK: No workspace access = no sidebar items
  if (noAccess && !isPlatformAdmin) {
    return [];
  }

  return WORKSPACE_MODULES
    .filter(module => {
      // Must have a route to be navigable
      if (!module.route) return false;

      // Owner sees everything (no permission checks)
      if (isOwner) return true;

      // If module has permissions, check view access
      if (module.hasPermissions) {
        return permissions[module.key]?.view === true;
      }

      return true;
    });
}