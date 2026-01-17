import React from 'react';
import { useTenant } from '@/components/hooks/useTenant';
import { User, Mail, Shield, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import MyAccessSummary from '@/components/profile/MyAccessSummary';

export default function ProfilePage() {
  const { user, tenant, membership, loading } = useTenant();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Loading profile...</p>
        </div>
      </div>
    );
  }

  const getRoleBadge = (role) => {
    const config = {
      owner: { color: 'bg-purple-100 text-purple-700', label: 'Owner' },
      admin: { color: 'bg-indigo-100 text-indigo-700', label: 'Admin' },
      manager: { color: 'bg-blue-100 text-blue-700', label: 'Manager' },
      staff: { color: 'bg-slate-100 text-slate-700', label: 'Staff' }
    };
    const { color, label } = config[role] || config.staff;
    return <Badge className={color}>{label}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-slate-900">My Profile</h1>
        <p className="text-slate-500 mt-1">Manage your account information and view your permissions</p>
      </div>

      {/* Profile Info */}
      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Account Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Avatar */}
            <div className="text-center">
              <div className="w-24 h-24 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 flex items-center justify-center mx-auto mb-3">
                <span className="text-3xl font-bold text-white">
                  {user?.full_name?.charAt(0)?.toUpperCase() || 'U'}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-slate-900">{user?.full_name}</h3>
              <p className="text-sm text-slate-500">{user?.email}</p>
            </div>

            {/* Details */}
            <div className="space-y-4 pt-4 border-t border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <Mail className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Email</p>
                  <p className="text-sm font-medium text-slate-900">{user?.email}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Role</p>
                  <div className="mt-1">
                    {getRoleBadge(membership?.role)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                  <User className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Workspace</p>
                  <p className="text-sm font-medium text-slate-900">{tenant?.name}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Member Since</p>
                  <p className="text-sm font-medium text-slate-900">
                    {new Date(membership?.created_date).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Permissions Summary */}
        <div className="lg:col-span-2">
          <MyAccessSummary />
        </div>
      </div>
    </div>
  );
}