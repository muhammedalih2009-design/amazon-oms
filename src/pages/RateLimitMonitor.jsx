import React, { useState, useEffect } from 'react';
import { apiClient } from '@/components/utils/apiClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RefreshCw, AlertTriangle, Activity, Database, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function RateLimitMonitor() {
  const [stats, setStats] = useState(null);
  const [rateLimits, setRateLimits] = useState([]);

  const refreshStats = () => {
    setStats(apiClient.getStats());
    setRateLimits(apiClient.getRecentRateLimits());
  };

  useEffect(() => {
    refreshStats();
    const interval = setInterval(refreshStats, 2000);
    return () => clearInterval(interval);
  }, []);

  if (!stats) return null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Rate Limit Monitor</h1>
          <p className="text-slate-600 mt-1">Real-time API performance and caching statistics</p>
        </div>
        <Button onClick={refreshStats} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
              <Database className="w-4 h-4" />
              Cache Size
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-slate-900">{stats.cacheSize}</p>
            <p className="text-xs text-slate-500 mt-1">cached responses</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Active Requests
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-blue-600">{stats.activeRequests}</p>
            <p className="text-xs text-slate-500 mt-1">in progress</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Queued Requests
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-amber-600">{stats.queuedRequests}</p>
            <p className="text-xs text-slate-500 mt-1">waiting</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Rate Limits (1m)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-red-600">{stats.rateLimitEvents}</p>
            <p className="text-xs text-slate-500 mt-1">last minute</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Rate Limit Events</CardTitle>
        </CardHeader>
        <CardContent>
          {rateLimits.length === 0 ? (
            <p className="text-slate-500 text-sm">No rate limits in the last minute ✓</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {rateLimits.map((event, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                    <div>
                      <p className="text-sm font-medium text-red-900">Retry {event.retry}</p>
                      <p className="text-xs text-red-700">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm text-red-700 font-medium">Delay: {event.delay}ms</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>System Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded">
            <span className="text-sm font-medium">Concurrency Limit</span>
            <span className="text-sm text-slate-700">4 requests max</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded">
            <span className="text-sm font-medium">Cache TTL</span>
            <span className="text-sm text-slate-700">60 seconds</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded">
            <span className="text-sm font-medium">Retry Strategy</span>
            <span className="text-sm text-slate-700">Exponential backoff (1s → 16s)</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded">
            <span className="text-sm font-medium">Request Deduplication</span>
            <span className="text-sm text-green-700 font-medium">✓ Active</span>
          </div>
        </CardContent>
      </Card>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-semibold text-blue-900 mb-2">How It Works</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• <strong>Request Caching:</strong> Responses cached for 60s to reduce API calls</li>
          <li>• <strong>Request Coalescing:</strong> Duplicate in-flight requests share same promise</li>
          <li>• <strong>Concurrency Control:</strong> Max 4 parallel requests to prevent bursts</li>
          <li>• <strong>Auto Retry:</strong> Rate-limited requests retry with exponential backoff</li>
          <li>• <strong>Smart Invalidation:</strong> Cache cleared on create/update/delete operations</li>
        </ul>
      </div>
    </div>
  );
}