import React, { useState } from 'react';
import { useTenant } from '@/components/hooks/useTenant';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/components/utils/apiClient';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { 
  AlertCircle, 
  Clock, 
  Activity, 
  TrendingUp,
  RefreshCw,
  CheckCircle,
  XCircle,
  Pause,
  Play,
  StopCircle
} from 'lucide-react';

export default function MonitoringPage() {
  const { isPlatformAdmin, tenantId } = useTenant();
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [actioningJob, setActioningJob] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [jobFilter, setJobFilter] = useState('active'); // all | active | completed

  const { data: errorLogs = [], refetch: refetchErrors } = useQuery({
    queryKey: ['error-logs'],
    queryFn: () => apiClient.list('ErrorLog', {}, '-created_date', 50, { useCache: false }),
    staleTime: 10000
  });

  const { data: slowQueries = [], refetch: refetchSlowQueries } = useQuery({
    queryKey: ['slow-queries'],
    queryFn: () => apiClient.list('SlowQuery', {}, '-created_date', 50, { useCache: false }),
    staleTime: 10000
  });

  const { data: auditLogs = [], refetch: refetchAudit } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => apiClient.list('AuditLog', {}, '-created_date', 100, { useCache: false }),
    staleTime: 10000
  });

  const { data: jobs = [], refetch: refetchJobs } = useQuery({
    queryKey: ['background-jobs', tenantId, isPlatformAdmin],
    queryFn: async () => {
      // Filter by workspace if not platform admin
      const query = isPlatformAdmin ? {} : { tenant_id: tenantId };
      return apiClient.list('BackgroundJob', query, '-created_date', 100, { useCache: false });
    },
    staleTime: 3000,
    enabled: !!tenantId
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      refetchErrors(),
      refetchSlowQueries(),
      refetchAudit(),
      refetchJobs()
    ]);
    setRefreshing(false);
  };

  // Auto-refresh jobs every 3 seconds
  React.useEffect(() => {
    const interval = setInterval(() => {
      refetchJobs();
    }, 3000);
    return () => clearInterval(interval);
  }, [refetchJobs]);

  const handleJobAction = async (jobId, action) => {
    setActioningJob(jobId);
    try {
      let result;
      if (action === 'pause') {
        result = await base44.functions.invoke('pauseJob', { job_id: jobId });
      } else if (action === 'resume') {
        result = await base44.functions.invoke('resumeJob', { job_id: jobId });
      } else if (action === 'force_stop') {
        result = await base44.functions.invoke('forceStopJob', { job_id: jobId });
      }

      if (result.data.success) {
        toast({ title: result.data.message || 'Action completed' });
        await refetchJobs();
      } else {
        toast({ 
          title: 'Action failed', 
          description: result.data.error,
          variant: 'destructive' 
        });
      }
    } catch (error) {
      toast({ 
        title: 'Action failed', 
        description: error.message,
        variant: 'destructive' 
      });
    } finally {
      setActioningJob(null);
      setConfirmAction(null);
    }
  };

  const getJobStatusBadge = (status) => {
    const variants = {
      running: 'default',
      pausing: 'secondary',
      paused: 'outline',
      resuming: 'secondary',
      cancelling: 'secondary',
      cancelled: 'destructive',
      completed: 'outline',
      failed: 'destructive',
      queued: 'secondary',
      throttled: 'secondary'
    };
    return variants[status] || 'secondary';
  };

  if (!isPlatformAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-4">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto" />
          <h1 className="text-2xl font-bold text-slate-900">Access Denied</h1>
          <p className="text-slate-600">Platform admin access required</p>
        </div>
      </div>
    );
  }

  const unresolvedErrors = errorLogs.filter(e => !e.resolved);
  const avgSlowQueryDuration = slowQueries.length > 0
    ? Math.round(slowQueries.reduce((sum, q) => sum + q.duration_ms, 0) / slowQueries.length)
    : 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">System Monitoring</h1>
          <p className="text-slate-600 mt-1">Platform-wide error tracking and performance metrics</p>
        </div>
        <Button onClick={handleRefresh} disabled={refreshing} variant="outline">
          <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-600" />
              Unresolved Errors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-red-600">{unresolvedErrors.length}</p>
            <p className="text-xs text-slate-500 mt-1">Last 50 errors</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600" />
              Slow Queries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-amber-600">{slowQueries.length}</p>
            <p className="text-xs text-slate-500 mt-1">Avg: {avgSlowQueryDuration}ms</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-600" />
              Running Jobs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-blue-600">
              {jobs.filter(j => j.status === 'running').length}
            </p>
            <p className="text-xs text-slate-500 mt-1">Active background jobs</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              Audit Events
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-emerald-600">{auditLogs.length}</p>
            <p className="text-xs text-slate-500 mt-1">Recent actions</p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Tabs */}
      <Tabs defaultValue="errors" className="space-y-4">
        <TabsList>
          <TabsTrigger value="errors">
            <AlertCircle className="w-4 h-4 mr-2" />
            Errors
          </TabsTrigger>
          <TabsTrigger value="slow">
            <Clock className="w-4 h-4 mr-2" />
            Slow Queries
          </TabsTrigger>
          <TabsTrigger value="audit">
            <CheckCircle className="w-4 h-4 mr-2" />
            Audit Log
          </TabsTrigger>
          <TabsTrigger value="jobs">
            <Activity className="w-4 h-4 mr-2" />
            Jobs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="errors">
          <Card>
            <CardHeader>
              <CardTitle>Recent Error Logs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {errorLogs.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    <CheckCircle className="w-12 h-12 mx-auto mb-3 text-emerald-500" />
                    <p>No errors logged recently</p>
                  </div>
                ) : (
                  errorLogs.map(error => (
                    <div key={error.id} className="border rounded-lg p-4 space-y-2">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <Badge variant={error.resolved ? 'outline' : 'destructive'}>
                              {error.http_status || 500}
                            </Badge>
                            <span className="font-mono text-sm text-slate-700">{error.endpoint}</span>
                          </div>
                          <p className="text-sm text-red-600 mt-2">{error.error_message}</p>
                          {error.user_email && (
                            <p className="text-xs text-slate-500 mt-1">User: {error.user_email}</p>
                          )}
                        </div>
                        <span className="text-xs text-slate-400">
                          {new Date(error.created_date).toLocaleString()}
                        </span>
                      </div>
                      {error.stack_trace && (
                        <details className="text-xs bg-slate-50 p-3 rounded border">
                          <summary className="cursor-pointer text-slate-600 font-medium">
                            Stack Trace
                          </summary>
                          <pre className="mt-2 text-slate-700 overflow-x-auto whitespace-pre-wrap">
                            {error.stack_trace}
                          </pre>
                        </details>
                      )}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="slow">
          <Card>
            <CardHeader>
              <CardTitle>Slow Queries (&gt; 300ms)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {slowQueries.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    <Clock className="w-12 h-12 mx-auto mb-3 text-emerald-500" />
                    <p>No slow queries detected</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b">
                        <tr>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-slate-600">
                            Endpoint
                          </th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-slate-600">
                            Query
                          </th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-slate-600">
                            Duration
                          </th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-slate-600">
                            Rows
                          </th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-slate-600">
                            Time
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {slowQueries.map(query => (
                          <tr key={query.id} className="border-b hover:bg-slate-50">
                            <td className="py-2 px-3 text-sm font-mono">{query.endpoint}</td>
                            <td className="py-2 px-3 text-sm text-slate-600">{query.query_name}</td>
                            <td className="py-2 px-3 text-sm text-right">
                              <Badge variant={query.duration_ms > 1000 ? 'destructive' : 'outline'}>
                                {query.duration_ms}ms
                              </Badge>
                            </td>
                            <td className="py-2 px-3 text-sm text-right text-slate-600">
                              {query.rows_returned || 0}
                            </td>
                            <td className="py-2 px-3 text-xs text-right text-slate-400">
                              {new Date(query.created_date).toLocaleTimeString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle>Audit Trail</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {auditLogs.map(log => (
                  <div key={log.id} className="flex items-center justify-between py-2 px-3 border-b hover:bg-slate-50">
                    <div className="flex items-center gap-3">
                      <Badge>{log.action}</Badge>
                      <span className="text-sm text-slate-700">{log.entity_type}</span>
                      <span className="text-xs text-slate-500">{log.user_email}</span>
                    </div>
                    <span className="text-xs text-slate-400">
                      {new Date(log.created_date).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="jobs">
          <Card>
            <CardHeader>
              <CardTitle>Background Jobs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {jobs.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    <Activity className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p>No background jobs</p>
                  </div>
                ) : (
                  jobs.map(job => (
                    <div key={job.id} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <Badge variant={getJobStatusBadge(job.status)}>
                              {job.status}
                            </Badge>
                            <span className="font-medium text-slate-900">{job.job_type}</span>
                          </div>
                          
                          {job.progress_percent > 0 && (
                            <div className="mb-2">
                              <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                                <span>Progress</span>
                                <span>{job.progress_percent}%</span>
                              </div>
                              <div className="w-full bg-slate-200 rounded-full h-2">
                                <div 
                                  className="bg-indigo-600 h-2 rounded-full transition-all"
                                  style={{ width: `${job.progress_percent}%` }}
                                />
                              </div>
                            </div>
                          )}

                          {job.processed_count !== undefined && (
                            <p className="text-xs text-slate-500">
                              Processed: {job.processed_count}
                              {job.total_count && ` / ${job.total_count}`}
                            </p>
                          )}

                          {job.status === 'paused' && job.progress_percent > 0 && (
                            <p className="text-xs text-amber-600 mt-1">
                              ⏸ Paused at {job.progress_percent}%
                            </p>
                          )}

                          {job.error_message && (
                            <p className="text-xs text-red-600 mt-2">{job.error_message}</p>
                          )}

                          <p className="text-xs text-slate-400 mt-2">
                            Started: {new Date(job.created_date).toLocaleString()}
                          </p>
                        </div>

                        <div className="flex gap-2 ml-4">
                          {/* Pause button */}
                          {['running', 'throttled'].includes(job.status) && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={actioningJob === job.id}
                              onClick={() => setConfirmAction({ job, action: 'pause' })}
                            >
                              <Pause className="w-4 h-4 mr-1" />
                              Pause
                            </Button>
                          )}

                          {/* Resume button */}
                          {job.status === 'paused' && job.can_resume !== false && (
                            <Button
                              size="sm"
                              className="bg-indigo-600 hover:bg-indigo-700"
                              disabled={actioningJob === job.id}
                              onClick={() => handleJobAction(job.id, 'resume')}
                            >
                              <Play className="w-4 h-4 mr-1" />
                              Resume
                            </Button>
                          )}

                          {/* Force Stop button */}
                          {['running', 'throttled', 'pausing', 'resuming'].includes(job.status) && (
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={actioningJob === job.id}
                              onClick={() => setConfirmAction({ job, action: 'force_stop' })}
                            >
                              <StopCircle className="w-4 h-4 mr-1" />
                              Force Stop
                            </Button>
                          )}

                          {/* Status indicators for transitional states */}
                          {job.status === 'pausing' && (
                            <Badge variant="secondary">Pausing...</Badge>
                          )}
                          {job.status === 'cancelling' && (
                            <Badge variant="secondary">Stopping...</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Confirmation Dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.action === 'pause' && 'Pause Job?'}
              {confirmAction?.action === 'force_stop' && 'Force Stop Job?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.action === 'pause' && (
                <>
                  Pause will stop the job safely at the next batch boundary. 
                  You can resume it later from where it stopped.
                </>
              )}
              {confirmAction?.action === 'force_stop' && (
                <>
                  Force Stop will cancel this job permanently and you <strong>cannot resume it</strong>. 
                  The job will stop at the next safe point.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleJobAction(confirmAction.job.id, confirmAction.action)}
              className={confirmAction?.action === 'force_stop' ? 'bg-red-600 hover:bg-red-700' : ''}
            >
              {confirmAction?.action === 'pause' && 'Pause Job'}
              {confirmAction?.action === 'force_stop' && 'Force Stop'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}