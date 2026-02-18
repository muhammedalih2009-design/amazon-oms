import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from './utils';
import { base44 } from '@/api/base44Client';
import { TenantProvider, useTenant } from '@/components/hooks/useTenant';
import { TaskManagerProvider } from '@/components/hooks/useTaskManager';
import { LanguageProvider, useLanguage } from '@/components/contexts/LanguageContext';
import { ThemeProvider, useTheme } from '@/components/contexts/ThemeContext';
import TaskTray from '@/components/shared/TaskTray';
import BackgroundJobManager from '@/components/shared/BackgroundJobManager';
import WorkspaceSwitcher from '@/components/shared/WorkspaceSwitcher';
import WorkspaceAccessGuard from '@/components/shared/WorkspaceAccessGuard';
import { Toaster } from '@/components/ui/toaster';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  ClipboardList,
  Truck,
  RotateCcw,
  Users,
  Menu,
  X,
  ChevronDown,
  LogOut,
  Settings,
  Moon,
  Sun,
  Shield,
  CheckSquare,
  Store,
  TrendingUp,
  Activity,
  Languages
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';

const navItems = [
  { nameKey: 'dashboard', icon: LayoutDashboard, page: 'Dashboard', pageKey: 'dashboard', moduleKey: 'dashboard' },
  { nameKey: 'stores', icon: Store, page: 'Stores', pageKey: 'skus', moduleKey: 'stores' },
  { nameKey: 'skus_products', icon: Package, page: 'SKUs', pageKey: 'skus', moduleKey: 'skus_products' },
  { nameKey: 'orders', icon: ShoppingCart, page: 'Orders', pageKey: 'orders', moduleKey: 'orders' },
  { nameKey: 'profitability', icon: TrendingUp, page: 'Profitability', pageKey: 'orders', moduleKey: 'profitability' },
  { nameKey: 'purchase_requests', icon: ClipboardList, page: 'PurchaseRequests', pageKey: 'orders', moduleKey: 'purchase_requests' },
  { nameKey: 'purchases', icon: Truck, page: 'Purchases', pageKey: 'purchases', moduleKey: 'purchases' },
  { nameKey: 'returns', icon: RotateCcw, page: 'Returns', pageKey: 'returns', moduleKey: 'returns' },
  { nameKey: 'suppliers', icon: Users, page: 'Suppliers', pageKey: 'suppliers', moduleKey: 'suppliers' },
  { nameKey: 'tasks', icon: CheckSquare, page: 'Tasks', pageKey: 'tasks', moduleKey: 'tasks' },
];

const adminNavItems = [
  { name: 'Platform Admin', icon: Shield, page: 'Admin' },
  { name: 'Emergency Restore', icon: Shield, page: 'EmergencyRestore' },
  { name: 'Rate Limit Monitor', icon: Activity, page: 'RateLimitMonitor' },
  { name: 'System Monitoring', icon: Activity, page: 'Monitoring' },
];

function LayoutContent({ children, currentPageName }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { tenant, user, loading, subscription, isPlatformAdmin, canViewPage, isOwner, isModuleEnabled } = useTenant();
  const { t, language, toggleLanguage, isRTL } = useLanguage();
  const { theme, toggleTheme, isDark } = useTheme();

  const getInitials = (name) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const handleLogout = () => {
    base44.auth.logout();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-600">Loading workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b z-50 flex items-center px-4">
        <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
          <Menu className="w-5 h-5" />
        </Button>
        <span className="ml-3 font-bold text-lg bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
          Amazon OMS
        </span>
      </div>

      {/* Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 ${isRTL ? 'right-0 border-l' : 'left-0 border-r'} h-full w-72 z-50 transform transition-transform duration-300
        lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : isRTL ? 'translate-x-full' : '-translate-x-full'}
      `} style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="h-full flex flex-col">
          {/* Logo */}
          <div className="h-16 flex items-center justify-between px-6" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="font-bold text-xl bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
              Amazon OMS
            </span>
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(false)}>
              <X className="w-5 h-5" />
            </Button>
          </div>

          {/* Workspace Switcher */}
          <div className="px-4 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <WorkspaceSwitcher />
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              // Check module access first
              if (item.moduleKey && !isModuleEnabled(item.moduleKey)) {
                return null; // Hide disabled modules
              }

              // Hide menu item if user doesn't have view permission (skip for owners)
              if (!isOwner && item.pageKey && !canViewPage(item.pageKey)) {
                return null;
              }

              const isActive = currentPageName === item.page;
              return (
                <Link
                  key={item.page}
                  to={createPageUrl(item.page)}
                  onClick={() => setSidebarOpen(false)}
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200
                    ${isRTL ? 'flex-row-reverse' : ''}
                    ${isActive 
                      ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-200' 
                      : 'text-slate-600 hover:bg-slate-100'}
                  `}
                >
                  <item.icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span className="font-medium">{t(item.nameKey)}</span>
                </Link>
              );
            })}

            {isOwner && isModuleEnabled('team') && (
              <Link
                to={createPageUrl('Team')}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 mt-4
                  ${isRTL ? 'flex-row-reverse' : ''}
                  ${currentPageName === 'Team'
                    ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg'
                    : 'text-slate-600 hover:bg-slate-100 border border-slate-200'}
                `}
              >
                <Users className="w-5 h-5" />
                <span className="font-medium">{t('team')}</span>
              </Link>
            )}

            {isModuleEnabled('settings') && (
              <Link
                to={createPageUrl('Settings')}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200
                  ${isRTL ? 'flex-row-reverse' : ''}
                  ${currentPageName === 'Settings'
                    ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg'
                    : 'text-slate-600 hover:bg-slate-100 border border-slate-200'}
                `}
              >
                <Settings className="w-5 h-5" />
                <span className="font-medium">{t('settings')}</span>
              </Link>
            )}

            {(user?.role === 'admin' || user?.email === 'your-admin@email.com') && (
              <div className="mt-4 pt-4 border-t border-slate-200">
                <p className="px-4 text-xs font-semibold text-slate-500 uppercase mb-2">Admin Tools</p>
                {adminNavItems.map((item) => {
                  const isActive = currentPageName === item.page;
                  return (
                    <Link
                      key={item.page}
                      to={createPageUrl(item.page)}
                      onClick={() => setSidebarOpen(false)}
                      className={`
                        flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 mb-1
                        ${isActive
                          ? 'bg-gradient-to-r from-red-600 to-orange-600 text-white shadow-lg'
                          : 'text-red-600 hover:bg-red-50 border border-red-200'}
                      `}
                    >
                      <item.icon className="w-5 h-5" />
                      <span className="font-medium">{item.name}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </nav>

          {/* User Menu & Language Toggle */}
          <div className="p-4 space-y-3" style={{ borderTop: '1px solid var(--border)' }}>
            {/* Theme & Language Toggles */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={toggleTheme}
                className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm font-medium"
                style={{ 
                  backgroundColor: 'var(--accent)', 
                  color: 'var(--text-primary)'
                }}
                title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              >
                {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button
                onClick={toggleLanguage}
                className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm font-medium"
                style={{ 
                  backgroundColor: 'var(--accent)', 
                  color: 'var(--text-primary)'
                }}
              >
                <Languages className="w-4 h-4" />
                {language === 'ar' ? 'EN' : 'ع'}
              </button>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={`w-full flex items-center gap-3 p-3 rounded-xl transition-colors ${isRTL ? 'flex-row-reverse' : ''}`} style={{ backgroundColor: 'transparent' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-bg)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                  <Avatar className="w-10 h-10 bg-gradient-to-r from-indigo-600 to-violet-600">
                    <AvatarFallback className="bg-transparent text-white font-semibold">
                      {getInitials(user?.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className={`flex-1 ${isRTL ? 'text-right' : 'text-left'}`}>
                    <p className="font-medium text-slate-900 text-sm truncate">{user?.full_name}</p>
                    <p className="text-xs text-slate-500 truncate">{user?.email}</p>
                  </div>
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`${isRTL ? 'lg:mr-72' : 'lg:ml-72'} min-h-screen pt-16 lg:pt-0`} style={{ backgroundColor: 'var(--background)' }}>
        <div className="p-6 lg:p-8">
          {children}
        </div>
      </main>

      {/* Debug indicator - visible to admins only */}
      {isPlatformAdmin && (
        <div className="theme-debug">
          Theme: {theme}
        </div>
      )}
    </div>
  );
}

export default function Layout({ children, currentPageName }) {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <TenantProvider>
          <TaskManagerProvider>
            <WorkspaceAccessGuard>
              <LayoutContent currentPageName={currentPageName}>
                {children}
              </LayoutContent>
            </WorkspaceAccessGuard>
            <TaskTray />
            <BackgroundJobManager />
            <Toaster />
          </TaskManagerProvider>
        </TenantProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}