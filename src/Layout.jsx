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
import WorkspaceRouteGuard from '@/components/shared/WorkspaceRouteGuard';
import PendingInvitesChecker from '@/components/shared/PendingInvitesChecker';
import { Toaster } from '@/components/ui/toaster';
import { getSidebarItems } from '@/components/shared/modulesConfig';
import {
  Menu,
  X,
  ChevronDown,
  LogOut,
  Moon,
  Sun,
  Shield,
  Activity,
  Languages,
  BookOpen
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

// REMOVED: navItems are now computed dynamically per user

const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';

const adminNavItems = [
  { name: 'Platform Admin', nameKey: 'platform_admin', icon: Shield, page: 'Admin' },
  { name: 'Emergency Restore', nameKey: 'emergency_restore', icon: Shield, page: 'EmergencyRestore' },
  { name: 'Rate Limit Monitor', nameKey: 'rate_limit_monitor', icon: Activity, page: 'RateLimitMonitor' },
  { name: 'System Monitoring', nameKey: 'system_monitoring', icon: Activity, page: 'Monitoring' },
];

function LayoutContent({ children, currentPageName }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { tenant, user, loading, subscription, isPlatformAdmin, permissions, isOwner, isModuleEnabled, noAccess, hasWorkspaceAccess } = useTenant();
  const { t, language, toggleLanguage, isRTL } = useLanguage();
  const { theme, toggleTheme, isDark } = useTheme();

  // DYNAMIC: Compute sidebar items based on user permissions
  const navItems = getSidebarItems(permissions, isOwner, noAccess, isPlatformAdmin);

  const getInitials = (name) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const handleLogout = () => {
    base44.auth.logout();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg)' }}>
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p style={{ color: 'var(--text-muted)' }}>Loading workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg)' }}>
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 z-50 flex items-center px-4" style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
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
            {noAccess && !isPlatformAdmin ? (
              /* SECURITY: No workspace access - show empty state ONLY */
              <div className="px-4 py-6 text-center">
                <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ backgroundColor: 'var(--warning-soft)' }}>
                  <Shield className="w-6 h-6" style={{ color: 'var(--warning)' }} />
                </div>
                <p className="text-sm font-medium mb-2" style={{ color: 'var(--text)' }}>
                  No Workspaces Assigned
                </p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Contact the app administrator to request workspace access
                </p>
              </div>
            ) : (
              /* Has workspace access - render items from single source of truth */
              navItems.map((item) => {
                const isActive = currentPageName === item.route;
                const Icon = item.icon;
                
                return (
                  <Link
                    key={item.key}
                    to={createPageUrl(item.route)}
                    onClick={() => setSidebarOpen(false)}
                    className={`
                      flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200
                      ${isRTL ? 'flex-row-reverse' : ''}
                      ${isActive 
                        ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg' 
                        : ''}
                    `}
                    style={!isActive ? { color: 'var(--text-muted)' } : {}}
                    onMouseEnter={(e) => !isActive && (e.currentTarget.style.backgroundColor = 'var(--hover-bg)')}
                    onMouseLeave={(e) => !isActive && (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                    <span className="font-medium">{item.label}</span>
                  </Link>
                );
              })
            )}

            {user?.email?.toLowerCase() === APP_OWNER_EMAIL.toLowerCase() && (
              <Link
                to={createPageUrl('OwnerLog')}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200
                  ${isRTL ? 'flex-row-reverse' : ''}
                  ${currentPageName === 'OwnerLog'
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg'
                    : ''}
                `}
                style={currentPageName !== 'OwnerLog' ? { color: '#9333ea', borderColor: '#e9d5ff', borderWidth: '1px', borderStyle: 'solid' } : {}}
                onMouseEnter={(e) => currentPageName !== 'OwnerLog' && (e.currentTarget.style.backgroundColor = '#faf5ff')}
                onMouseLeave={(e) => currentPageName !== 'OwnerLog' && (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <BookOpen className="w-5 h-5" />
                <span className="font-medium">Owner Log</span>
              </Link>
            )}

            {(user?.role === 'admin' || user?.email === 'your-admin@email.com') && (
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                <p className="px-4 text-xs font-semibold uppercase mb-2" style={{ color: 'var(--text-muted)' }}>{t('admin_tools') || 'Admin Tools'}</p>
                {adminNavItems.map((item) => {
                  const isActive = currentPageName === item.page;
                  return (
                    <Link
                      key={item.page}
                      to={createPageUrl(item.page)}
                      onClick={() => setSidebarOpen(false)}
                      className={`
                        flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 mb-1
                        ${isRTL ? 'flex-row-reverse' : ''}
                        ${isActive
                          ? 'bg-gradient-to-r from-red-600 to-orange-600 text-white shadow-lg'
                          : ''}
                      `}
                      style={!isActive ? { color: '#dc2626', borderColor: '#fecaca', borderWidth: '1px', borderStyle: 'solid' } : {}}
                      onMouseEnter={(e) => !isActive && (e.currentTarget.style.backgroundColor = '#fef2f2')}
                      onMouseLeave={(e) => !isActive && (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <item.icon className="w-5 h-5" />
                      <span className="font-medium">{t(item.nameKey || item.name.toLowerCase().replace(/\s+/g, '_'))}</span>
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
                    <p className="font-medium text-sm truncate" style={{ color: 'var(--text)' }}>{user?.full_name}</p>
                    <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{user?.email}</p>
                  </div>
                  <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                  <LogOut className={`w-4 h-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('sign_out') || 'Sign Out'}
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
          Theme: {theme} | Lang: {language} | Dir: {isRTL ? 'rtl' : 'ltr'}
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
              <WorkspaceRouteGuard pageName={currentPageName}>
                <LayoutContent currentPageName={currentPageName}>
                  {children}
                </LayoutContent>
              </WorkspaceRouteGuard>
            </WorkspaceAccessGuard>
            <PendingInvitesChecker />
            <TaskTray />
            <BackgroundJobManager />
            <Toaster />
          </TaskManagerProvider>
        </TenantProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}