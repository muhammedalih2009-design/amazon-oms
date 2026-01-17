import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from './utils';
import { base44 } from '@/api/base44Client';
import { TenantProvider, useTenant } from '@/components/hooks/useTenant';
import { Toaster } from '@/components/ui/toaster';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  ClipboardList,
  Truck,
  RotateCcw,
  DollarSign,
  Users,
  Menu,
  X,
  ChevronDown,
  LogOut,
  Settings,
  Moon,
  Sun,
  Shield
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
  { name: 'Dashboard', icon: LayoutDashboard, page: 'Dashboard', pageKey: 'dashboard' },
  { name: 'SKUs / Products', icon: Package, page: 'SKUs', pageKey: 'skus' },
  { name: 'Orders', icon: ShoppingCart, page: 'Orders', pageKey: 'orders' },
  { name: 'Purchase Requests', icon: ClipboardList, page: 'PurchaseRequests', pageKey: 'orders' },
  { name: 'Purchases', icon: Truck, page: 'Purchases', pageKey: 'purchases' },
  { name: 'Returns', icon: RotateCcw, page: 'Returns', pageKey: 'returns' },
  { name: 'Settlement', icon: DollarSign, page: 'Settlement', pageKey: 'settlement' },
  { name: 'Suppliers', icon: Users, page: 'Suppliers', pageKey: 'suppliers' },
];

function LayoutContent({ children, currentPageName }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const { tenant, user, loading, subscription, isPlatformAdmin, canViewPage, isOwner } = useTenant();

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
    <div className={`min-h-screen bg-slate-50 ${darkMode ? 'dark' : ''}`}>
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
        fixed top-0 left-0 h-full w-72 bg-white border-r z-50 transform transition-transform duration-300
        lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="h-full flex flex-col">
          {/* Logo */}
          <div className="h-16 flex items-center justify-between px-6 border-b">
            <span className="font-bold text-xl bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
              Amazon OMS
            </span>
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(false)}>
              <X className="w-5 h-5" />
            </Button>
          </div>

          {/* Tenant Info */}
          <div className="px-4 py-4 border-b">
            <div className="bg-gradient-to-r from-indigo-50 to-violet-50 rounded-xl p-3">
              <p className="text-xs text-slate-500 mb-1">Workspace</p>
              <p className="font-semibold text-slate-900 truncate">{tenant?.name || 'My Workspace'}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                  subscription?.plan === 'pro' ? 'bg-indigo-100 text-indigo-700' :
                  subscription?.plan === 'trial' ? 'bg-violet-100 text-violet-700' :
                  'bg-slate-100 text-slate-600'
                }`}>
                  {subscription?.plan?.toUpperCase() || 'FREE'}
                </span>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              // Hide menu item if user doesn't have view permission
              if (item.pageKey && !canViewPage(item.pageKey)) {
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
                    ${isActive 
                      ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-200' 
                      : 'text-slate-600 hover:bg-slate-100'}
                  `}
                >
                  <item.icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span className="font-medium">{item.name}</span>
                </Link>
              );
            })}

            {isOwner && (
              <Link
                to={createPageUrl('Team')}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 mt-4
                  ${currentPageName === 'Team'
                    ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg'
                    : 'text-slate-600 hover:bg-slate-100 border border-slate-200'}
                `}
              >
                <Users className="w-5 h-5" />
                <span className="font-medium">Team</span>
              </Link>
            )}

            {isPlatformAdmin && (
              <Link
                to={createPageUrl('Admin')}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 mt-4
                  ${currentPageName === 'Admin'
                    ? 'bg-gradient-to-r from-red-600 to-orange-600 text-white shadow-lg'
                    : 'text-red-600 hover:bg-red-50 border border-red-200'}
                `}
              >
                <Shield className="w-5 h-5" />
                <span className="font-medium">Platform Admin</span>
              </Link>
            )}
          </nav>

          {/* User Menu */}
          <div className="p-4 border-t">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors">
                  <Avatar className="w-10 h-10 bg-gradient-to-r from-indigo-600 to-violet-600">
                    <AvatarFallback className="bg-transparent text-white font-semibold">
                      {getInitials(user?.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 text-left">
                    <p className="font-medium text-slate-900 text-sm truncate">{user?.full_name}</p>
                    <p className="text-xs text-slate-500 truncate">{user?.email}</p>
                  </div>
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => setDarkMode(!darkMode)}>
                  {darkMode ? <Sun className="w-4 h-4 mr-2" /> : <Moon className="w-4 h-4 mr-2" />}
                  {darkMode ? 'Light Mode' : 'Dark Mode'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
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
      <main className="lg:ml-72 min-h-screen pt-16 lg:pt-0">
        <div className="p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

export default function Layout({ children, currentPageName }) {
  return (
    <TenantProvider>
      <LayoutContent currentPageName={currentPageName}>
        {children}
      </LayoutContent>
      <Toaster />
    </TenantProvider>
  );
}