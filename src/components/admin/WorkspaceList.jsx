import React, { useState } from 'react';
import { apiClient } from '@/components/utils/apiClient';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Building2, Users, Search, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function WorkspaceList() {
  const [search, setSearch] = useState('');

  const { data: workspaces = [], isLoading, refetch } = useQuery({
    queryKey: ['admin-workspaces'],
    queryFn: () => apiClient.list('Tenant', {}, '-created_date', 500, { useCache: false }),
    staleTime: 30000
  });

  const { data: allMemberships = [] } = useQuery({
    queryKey: ['admin-all-memberships'],
    queryFn: () => apiClient.list('Membership', {}, null, 2000, { useCache: false }),
    staleTime: 30000
  });

  const filteredWorkspaces = workspaces.filter(w =>
    w.name?.toLowerCase().includes(search.toLowerCase()) ||
    w.slug?.toLowerCase().includes(search.toLowerCase())
  );

  const getMemberCount = (workspaceId) => {
    return allMemberships.filter(m => m.tenant_id === workspaceId).length;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search workspaces..."
            className="pl-10"
          />
        </div>
        <Badge variant="outline" className="text-sm">
          {filteredWorkspaces.length} workspace(s)
        </Badge>
      </div>

      {isLoading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map(i => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-6 bg-slate-200 rounded w-1/3 mb-2"></div>
                <div className="h-4 bg-slate-100 rounded w-1/2"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredWorkspaces.map(workspace => (
            <Card key={workspace.id} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                      <Building2 className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{workspace.name}</CardTitle>
                      <p className="text-sm text-slate-500">/{workspace.slug || 'no-slug'}</p>
                    </div>
                  </div>
                  <Link to={createPageUrl('WorkspaceDetails') + `?id=${workspace.id}`}>
                    <Button size="sm" variant="outline">
                      <Settings className="w-4 h-4 mr-2" />
                      Manage
                    </Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-sm text-slate-600">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    <span>{getMemberCount(workspace.id)} members</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">•</span>
                    <span>Created {new Date(workspace.created_date).toLocaleDateString()}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}