import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function RecentWorkspacesMonitor() {
  const [recentWorkspaces, setRecentWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRecentWorkspaces();
  }, []);

  const loadRecentWorkspaces = async () => {
    try {
      // Get workspace creation logs from last 24 hours
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const auditLogs = await base44.entities.AuditLog.filter({
        action: 'workspace_created',
        entity_type: 'Tenant'
      });

      // Filter last 24h
      const recentLogs = auditLogs.filter(log => 
        new Date(log.created_date) > new Date(yesterday)
      );

      setRecentWorkspaces(recentLogs);
    } catch (error) {
      console.error('Failed to load recent workspaces:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return null;
  }

  if (recentWorkspaces.length === 0) {
    return (
      <div className="flex items-center gap-2 mt-2">
        <CheckCircle className="w-4 h-4 text-emerald-600" />
        <span className="text-sm text-emerald-600">
          No new workspaces created in the last 24 hours
        </span>
      </div>
    );
  }

  return (
    <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
      <div className="flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-blue-900">
            {recentWorkspaces.length} workspace{recentWorkspaces.length !== 1 ? 's' : ''} created in last 24h
          </p>
          <div className="mt-2 space-y-1">
            {recentWorkspaces.map((log) => {
              const metadata = log.metadata || {};
              const afterData = typeof log.after_data === 'string' 
                ? JSON.parse(log.after_data) 
                : log.after_data;
              
              return (
                <div key={log.id} className="flex items-center gap-2 text-xs text-blue-700">
                  <Badge variant="outline" className="font-mono text-xs">
                    {new Date(log.created_date).toLocaleString()}
                  </Badge>
                  <span className="font-medium">{afterData?.name || 'Unknown'}</span>
                  <span className="text-blue-500">by</span>
                  <span className="font-medium">{metadata.created_by || log.user_email}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}