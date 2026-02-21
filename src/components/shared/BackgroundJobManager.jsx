import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { X, Pause, Play, Ban, Loader2, AlertTriangle, RotateCcw } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

export default function BackgroundJobManager() {
  const { tenant, isPlatformAdmin, user } = useTenant();
  const { toast } = useToast();
  
  // CRITICAL: ALL hooks BEFORE any conditional logic
  const tenantId = tenant?.id;
  const [jobs, setJobs] = useState([]);
  const [dismissedJobIds, setDismissedJobIds] = useState(new Set());
  const pollIntervalRef = useRef(null);
  
  // Check platform admin status
  const isSuperAdmin = isPlatformAdmin || user?.email?.toLowerCase() === 'muhammedalih.2009@gmail.com';
  
  // Debug logging (MUST be before early return)
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Job Manager] User access check:', {
        email: user?.email,
        isPlatformAdmin,
        isSuperAdmin,
        hudEnabled: true,
        pollingEnabled: true
      });
    }
  }, [user, isPlatformAdmin, isSuperAdmin]);

  // Main polling effect (MUST be before early return)
  useEffect(() => {
    if (!isSuperAdmin) {
      console.log('[Job Manager] Not super admin - no polling');
      setJobs([]);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    // Fetch function defined inline to avoid dependency issues
    const fetchJobs = async () => {
      try {
        const { data } = await base44.functions.invoke('listBackgroundJobs', {});
        
        if (!data.ok) {
          throw new Error(data.error || 'Failed to fetch jobs');
        }

        const activeJobs = data.jobs || [];
        console.log('[Job Manager] Fetched jobs:', activeJobs.length);

        // Validate jobs
        const validJobs = activeJobs.filter(job => {
          if (!job.job_type || !job.total_count || job.total_count === 0) return false;
          const jobAge = Date.now() - new Date(job.created_date).getTime();
          const hoursSinceCreated = jobAge / (1000 * 60 * 60);
          return !(hoursSinceCreated > 24 && job.status === 'running');
        });

        // De-duplicate
        const uniqueJobs = [];
        const seenIds = new Set();
        for (const job of validJobs) {
          if (!seenIds.has(job.id)) {
            seenIds.add(job.id);
            uniqueJobs.push(job);
          }
        }

        // Filter dismissed
        const visibleJobs = uniqueJobs.filter(job => !dismissedJobIds.has(job.id));
        setJobs(visibleJobs);

        // Clean up dismissed IDs
        const activeJobIds = new Set(validJobs.map(j => j.id));
        const newDismissedIds = new Set([...dismissedJobIds].filter(id => activeJobIds.has(id)));
        if (newDismissedIds.size !== dismissedJobIds.size) {
          setDismissedJobIds(newDismissedIds);
        }

        // Stop polling if no jobs
        if (uniqueJobs.length === 0) {
          console.log('[Job Manager] No jobs - stopping polling');
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }
      } catch (error) {
        console.error('[Job Manager] Fetch error:', error);
        if (error.response?.status === 403 || error.status === 403) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }
        setJobs([]);
      }
    };

    // Initial fetch
    console.log('[Job Manager] Initial fetch');
    fetchJobs();

    // Start polling
    if (!pollIntervalRef.current) {
      console.log('[Job Manager] Starting polling');
      pollIntervalRef.current = setInterval(fetchJobs, 5000);
    }

    // Cleanup
    return () => {
      console.log('[Job Manager] Cleanup');
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [isSuperAdmin, dismissedJobIds]);

  // SECURITY: Early return AFTER all hooks
  if (!isSuperAdmin) {
    return null;
  }

  // Don't render if no jobs
  if (!jobs || jobs.length === 0) {
    return null;
  }

  const fetchJobs = async () => {
    if (!isSuperAdmin) {
      console.log('[Job Manager] Not super admin - skipping fetch');
      return;
    }

    try {
      // Call dedicated server endpoint (403 for non-admins)
      const { data } = await base44.functions.invoke('listBackgroundJobs', {});
      
      if (!data.ok) {
        throw new Error(data.error || 'Failed to fetch jobs');
      }

      const activeJobs = data.jobs || [];
      console.log('[Job Manager] Fetched jobs from API:', activeJobs.length);

      // STRICT VALIDATION: Filter out any invalid/stale jobs
      const validJobs = activeJobs.filter(job => {
        // Must have a valid job_type
        if (!job.job_type) {
          console.warn('[Job Manager] ❌ Rejected: No job_type', job.id);
          return false;
        }
        
        // CRITICAL: Must have valid total_count > 0
        if (!job.total_count || job.total_count === 0) {
          console.warn('[Job Manager] ❌ Rejected: Zero total_count', job.id, job.job_type);
          return false;
        }
        
        // Reject stale jobs (older than 24 hours and still "running")
        const jobAge = Date.now() - new Date(job.created_date).getTime();
        const hoursSinceCreated = jobAge / (1000 * 60 * 60);
        if (hoursSinceCreated > 24 && job.status === 'running') {
          console.warn('[Job Manager] ❌ Rejected: Stale job (24h+)', job.id, job.job_type);
          return false;
        }
        
        console.log('[Job Manager] ✅ Valid job:', job.id, job.job_type, `${job.processed_count || 0}/${job.total_count}`);
        return true;
      });

      // De-duplicate by job_id
      const uniqueJobs = [];
      const seenIds = new Set();
      for (const job of validJobs) {
        if (!seenIds.has(job.id)) {
          seenIds.add(job.id);
          uniqueJobs.push(job);
        }
      }

      // Filter out dismissed jobs (unless they're still active)
      const visibleJobs = uniqueJobs.filter(job => !dismissedJobIds.has(job.id));

      // ALWAYS set jobs, even if empty - this clears stale UI state
      console.log('[Job Manager] Setting jobs state:', visibleJobs.length, '(total:', uniqueJobs.length, ')');
      setJobs(visibleJobs);

      // Auto-clear dismissed IDs if those jobs no longer exist
      const activeJobIds = new Set(validJobs.map(j => j.id));
      const newDismissedIds = new Set([...dismissedJobIds].filter(id => activeJobIds.has(id)));
      if (newDismissedIds.size !== dismissedJobIds.size) {
        setDismissedJobIds(newDismissedIds);
      }

      // Stop polling if no jobs exist
      if (uniqueJobs.length === 0) {
        console.log('[Job Manager] No valid jobs - stopping polling');
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      }
    } catch (error) {
      console.error('[Job Manager] Fetch error:', error);
      
      // If 403, stop polling permanently
      if (error.response?.status === 403 || error.status === 403) {
        console.error('[Job Manager] 403 - stopping polling');
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      }
      
      // On error, clear jobs to avoid showing stale data
      setJobs([]);
    }
  };

  const forceStop = async (jobId) => {
    if (!jobId) {
      console.error('[Job Manager] Force stop: missing job_id');
      toast({
        title: 'Force stop failed',
        description: 'Job ID is missing',
        variant: 'destructive'
      });
      return;
    }

    console.log('[Job Manager] Force stop requested for job:', jobId);

    try {
      const payload = { job_id: jobId };
      console.log('[Job Manager] Force stop payload:', payload);

      const { data } = await base44.functions.invoke('forceStopJob', payload);
      console.log('[Job Manager] Force stop response:', data);

      if (data.success || data.ok) {
        toast({
          title: 'Force stop requested',
          description: 'Job is being terminated...',
          duration: 3000
        });
        fetchJobs();
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error) {
      console.error('[Job Manager] Force stop error:', error);
      console.error('[Job Manager] Error response:', error.response?.data);
      toast({
        title: 'Force stop failed',
        description: error.response?.data?.error || error.message || 'Failed to stop job',
        variant: 'destructive'
      });
    }
  };

  const manageJob = async (jobId, action) => {
    try {
      const { data } = await base44.functions.invoke('manageBackgroundJob', {
        job_id: jobId,
        action
      });

      if (data.ok) {
        toast({
          title: 'Success',
          description: data.message,
          duration: 3000
        });
        fetchJobs();
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      toast({
        title: 'Action failed',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const dismissJob = (jobId) => {
    console.log('[Job Manager] Dismissing job:', jobId);
    setDismissedJobIds(prev => new Set([...prev, jobId]));
  };

  const revertJob = async (jobId, jobType) => {
    try {
      const { data } = await base44.functions.invoke('revertBackgroundJob', {
        job_id: jobId,
        job_type: jobType
      });

      if (data.ok) {
        toast({
          title: 'Revert started',
          description: 'Reverting changes from this job...',
          duration: 3000
        });
        fetchJobs();
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('[Job Manager] Revert error:', error);
      toast({
        title: 'Revert failed',
        description: error.message || 'Failed to revert job',
        variant: 'destructive'
      });
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 space-y-2">
      {jobs.map(job => (
        <Card key={job.id} className="bg-white shadow-2xl border-2 border-slate-200 p-4">
          <div className="space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                {job.status === 'cancelling' ? (
                  <Ban className="w-5 h-5 text-red-600 animate-pulse" />
                ) : job.status === 'throttled' ? (
                  <AlertTriangle className="w-5 h-5 text-amber-600 animate-pulse" />
                ) : job.status === 'paused' ? (
                  <Pause className="w-5 h-5 text-blue-600" />
                ) : (
                  <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
                )}
                <div>
                  <p className="font-semibold text-sm text-slate-900">
                    {job.job_type === 'delete_all_skus' && 'Deleting All SKUs'}
                    {job.job_type === 'reset_stock' && 'Resetting Stock to Zero'}
                    {job.job_type === 'sku_bulk_upload' && 'Bulk Upload SKUs'}
                    {job.job_type === 'purchases_bulk_upload' && 'Bulk Upload Purchases'}
                    {job.job_type === 'telegram_export' && 'Telegram Export'}
                    {!['delete_all_skus', 'reset_stock', 'sku_bulk_upload', 'purchases_bulk_upload', 'telegram_export'].includes(job.job_type) && (job.job_type || 'Processing')}
                  </p>
                  <p className={`text-xs ${job.status === 'cancelling' ? 'text-red-600 font-medium' : 'text-slate-600'}`}>
                    {job.status === 'cancelling' ? 'Stopping...' : (job.progress?.message || job.status)}
                  </p>
                  </div>
                  </div>
                  <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-full hover:bg-slate-100"
                  onClick={() => dismissJob(job.id)}
                  title="Hide this job card"
                  >
                  <X className="w-4 h-4 text-slate-400" />
                  </Button>
                  </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>{job.processed_count || 0} / {job.total_count || 0}</span>
                <span>{job.progress_percent || 0}%</span>
              </div>
              <Progress value={job.progress_percent || 0} className="h-2" />
            </div>

            {job.status === 'throttled' && (
              <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-800">
                <AlertTriangle className="w-3 h-3 inline mr-1" />
                Rate limited - running slower to avoid errors
              </div>
            )}

            <div className="flex items-center gap-2">
              {job.status === 'cancelling' ? (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled
                  className="flex-1"
                >
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Stopping...
                </Button>
              ) : job.status === 'paused' ? (
                <>
                  <Button
                    size="sm"
                    onClick={() => manageJob(job.id, 'resume')}
                    className="flex-1 bg-green-600 hover:bg-green-700"
                  >
                    <Play className="w-3 h-3 mr-1" />
                    Resume
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => forceStop(job.id)}
                    className="flex-1"
                  >
                    <Ban className="w-3 h-3 mr-1" />
                    Force Stop
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => manageJob(job.id, 'pause')}
                    className="flex-1"
                  >
                    <Pause className="w-3 h-3 mr-1" />
                    Pause
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => forceStop(job.id)}
                    className="flex-1"
                  >
                    <Ban className="w-3 h-3 mr-1" />
                    Force Stop
                  </Button>
                </>
              )}
            </div>

            {['sku_bulk_upload', 'purchases_bulk_upload', 'reset_stock'].includes(job.job_type) && 
             ['completed', 'failed'].includes(job.status) && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => revertJob(job.id, job.job_type)}
                className="w-full text-amber-600 border-amber-200 hover:bg-amber-50"
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                Revert Changes
              </Button>
            )}

            <p className="text-xs text-slate-500">
              Polling every 5s • Workspace: {job.tenant_id?.slice(0, 8)}
            </p>
          </div>
        </Card>
      ))}
    </div>
  );
}