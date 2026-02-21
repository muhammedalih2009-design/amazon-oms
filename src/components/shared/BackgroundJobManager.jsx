import React, { useState, useEffect } from 'react';
import { apiClient } from '@/components/utils/apiClient';
import { useTenant } from '@/components/hooks/useTenant';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { X, Pause, Play, Ban, Loader2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

export default function BackgroundJobManager() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const [jobs, setJobs] = useState([]);
  const [pollInterval, setPollInterval] = useState(10000); // Start at 10s
  const { toast } = useToast();

  const fetchJobs = async () => {
    if (!tenantId) return;

    try {
      const activeJobs = await apiClient.list(
        'BackgroundJob',
        { 
          tenant_id: tenantId,
          status: { $in: ['queued', 'running', 'throttled', 'paused', 'cancelling'] }
        },
        '-created_date',
        5,
        { useCache: false }
      );

      setJobs(activeJobs);

      // Reset poll interval if jobs exist
      if (activeJobs.length > 0) {
        setPollInterval(10000);
      }
    } catch (error) {
      console.error('[Job Manager] Fetch error:', error);
      
      // If rate limited, exponentially back off
      if (error.message?.toLowerCase().includes('rate limit')) {
        setPollInterval(prev => Math.min(prev * 2, 60000));
        console.log(`[Job Manager] Rate limited, increasing poll interval to ${pollInterval}ms`);
      }
    }
  };

  const forceStop = async (jobId) => {
    try {
      const result = await apiClient.invokeFunction('forceStopJob', {
        job_id: jobId
      });

      if (result.success) {
        toast({
          title: 'Force stop requested',
          description: 'Job is being terminated...',
          duration: 3000
        });
        fetchJobs();
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      toast({
        title: 'Force stop failed',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const manageJob = async (jobId, action) => {
    try {
      const result = await apiClient.invokeFunction('manageBackgroundJob', {
        job_id: jobId,
        action
      });

      if (result.ok) {
        toast({
          title: 'Success',
          description: result.message,
          duration: 3000
        });
        fetchJobs();
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      toast({
        title: 'Action failed',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  useEffect(() => {
    if (!tenantId) return;

    fetchJobs();
    
    // Only poll if there are active jobs
    const interval = setInterval(() => {
      fetchJobs();
    }, pollInterval);

    return () => clearInterval(interval);
  }, [tenantId, pollInterval]);
  
  // Stop polling when no jobs exist
  useEffect(() => {
    if (jobs.length === 0) {
      setPollInterval(10000); // Reset to default
    }
  }, [jobs.length]);

  if (jobs.length === 0) return null;

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
                  </p>
                  <p className={`text-xs ${job.status === 'cancelling' ? 'text-red-600 font-medium' : 'text-slate-600'}`}>
                    {job.status === 'cancelling' ? 'Stopping...' : job.progress?.message}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>{job.progress?.current || 0} / {job.progress?.total || 0}</span>
                <span>{job.progress?.percent || 0}%</span>
              </div>
              <Progress value={job.progress?.percent || 0} className="h-2" />
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

            <p className="text-xs text-slate-500">
              Polling every {pollInterval / 1000}s
            </p>
          </div>
        </Card>
      ))}
    </div>
  );
}