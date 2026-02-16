import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Copy, Check, AlertCircle } from 'lucide-react';

export default function CloneWorkspaceModal({ workspace, open, onOpenChange, onSuccess }) {
  const { toast } = useToast();
  const [step, setStep] = useState('config'); // config | confirming | progress | done
  const [cloning, setCloning] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);

  const [formData, setFormData] = useState({
    name: workspace ? `${workspace.name} (Copy)` : '',
    slug: workspace ? `${workspace.slug}-copy` : '',
    copy_settings: true,
    copy_master_data: true,
    copy_operational_data: false,
    copy_logs: false,
    copy_members: false
  });

  const [confirmOpen, setConfirmOpen] = useState(false);

  // Poll job status
  useEffect(() => {
    if (!jobId || step !== 'progress') return;

    const interval = setInterval(async () => {
      try {
        const job = await base44.asServiceRole.entities.CloneJob.read(jobId);
        setJobStatus(job);

        if (job.status === 'completed') {
          setStep('done');
          clearInterval(interval);
        } else if (job.status === 'failed') {
          toast({
            title: 'Clone failed',
            description: job.error_message,
            variant: 'destructive'
          });
          setStep('config');
          clearInterval(interval);
        }
      } catch (error) {
        console.error('Error polling job:', error);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [jobId, step, toast]);

  const handleStartClone = async () => {
    if (!formData.name.trim()) {
      toast({
        title: 'Name required',
        description: 'Please enter a workspace name',
        variant: 'destructive'
      });
      return;
    }

    setCloning(true);
    try {
      const { data } = await base44.functions.invoke('cloneWorkspace', {
        source_workspace_id: workspace.id,
        target_workspace_name: formData.name.trim(),
        target_workspace_slug: formData.slug.trim(),
        options: {
          copy_settings: formData.copy_settings,
          copy_master_data: formData.copy_master_data,
          copy_operational_data: formData.copy_operational_data,
          copy_logs: formData.copy_logs,
          copy_members: formData.copy_members
        }
      });

      if (data.ok) {
        setJobId(data.clone_job_id);
        setStep('progress');
        setConfirmOpen(false);
      }
    } catch (error) {
      toast({
        title: 'Failed to start clone',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setCloning(false);
    }
  };

  const handleReset = () => {
    setStep('config');
    setJobId(null);
    setJobStatus(null);
    onOpenChange(false);
  };

  if (!workspace) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="w-5 h-5" />
              Clone Workspace
            </DialogTitle>
            <DialogDescription>
              Create a duplicate of "{workspace.name}" with selected data
            </DialogDescription>
          </DialogHeader>

          {step === 'config' && (
            <div className="space-y-6">
              {/* Source Info */}
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                <Label className="text-sm font-semibold text-slate-700">Source Workspace</Label>
                <p className="text-slate-900 font-medium mt-1">{workspace.name}</p>
                <p className="text-sm text-slate-500">{workspace.slug}</p>
              </div>

              {/* Target Name */}
              <div className="space-y-2">
                <Label className="font-medium">New Workspace Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="My Workspace (Copy)"
                />
              </div>

              {/* Target Slug */}
              <div className="space-y-2">
                <Label className="font-medium">Workspace Slug</Label>
                <Input
                  value={formData.slug}
                  onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                  placeholder="my-workspace-copy"
                />
              </div>

              {/* Copy Options */}
              <div className="space-y-3 border-t pt-4">
                <Label className="font-semibold text-slate-900">What to Copy</Label>

                <div className="flex items-start gap-3 p-3 bg-indigo-50 rounded-lg border border-indigo-200">
                  <Checkbox
                    id="copy_settings"
                    checked={formData.copy_settings}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, copy_settings: checked })
                    }
                  />
                  <div className="flex-1">
                    <Label htmlFor="copy_settings" className="font-medium cursor-pointer">
                      Settings & Integrations
                    </Label>
                    <p className="text-xs text-slate-600 mt-1">
                      Workspace config, Telegram, templates, blacklists
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-indigo-50 rounded-lg border border-indigo-200">
                  <Checkbox
                    id="copy_master"
                    checked={formData.copy_master_data}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, copy_master_data: checked })
                    }
                  />
                  <div className="flex-1">
                    <Label htmlFor="copy_master" className="font-medium cursor-pointer">
                      Master Data
                    </Label>
                    <p className="text-xs text-slate-600 mt-1">
                      Stores, Suppliers, SKUs / Products
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <Checkbox
                    id="copy_operational"
                    checked={formData.copy_operational_data}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, copy_operational_data: checked })
                    }
                  />
                  <div className="flex-1">
                    <Label htmlFor="copy_operational" className="font-medium cursor-pointer">
                      Operational Data
                    </Label>
                    <p className="text-xs text-slate-600 mt-1">
                      Orders, Purchases, Returns, Settlement data
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <Checkbox
                    id="copy_logs"
                    checked={formData.copy_logs}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, copy_logs: checked })
                    }
                  />
                  <div className="flex-1">
                    <Label htmlFor="copy_logs" className="font-medium cursor-pointer">
                      Logs
                    </Label>
                    <p className="text-xs text-slate-600 mt-1">
                      Audit logs, import history
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <Checkbox
                    id="copy_members"
                    checked={formData.copy_members}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, copy_members: checked })
                    }
                  />
                  <div className="flex-1">
                    <Label htmlFor="copy_members" className="font-medium cursor-pointer">
                      Team Members
                    </Label>
                    <p className="text-xs text-slate-600 mt-1">
                      Copy workspace members with same roles
                    </p>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => setConfirmOpen(true)}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Start Clone
                </Button>
              </div>
            </div>
          )}

          {step === 'progress' && jobStatus && (
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">Cloning...</span>
                  <span className="text-xs text-slate-500">{jobStatus.current_step}</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div
                    className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                    style={{
                      width: `${
                        jobStatus.status === 'completed'
                          ? 100
                          : Math.min(
                              (Object.values(jobStatus.progress || {}).reduce((a, b) => a + b, 0) / 50) * 100,
                              90
                            )
                      }%`
                    }}
                  />
                </div>
              </div>

              {/* Progress Summary */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                {jobStatus.progress?.stores > 0 && (
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>{jobStatus.progress.stores} Stores</span>
                  </div>
                )}
                {jobStatus.progress?.suppliers > 0 && (
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>{jobStatus.progress.suppliers} Suppliers</span>
                  </div>
                )}
                {jobStatus.progress?.skus > 0 && (
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>{jobStatus.progress.skus} SKUs</span>
                  </div>
                )}
                {jobStatus.progress?.orders > 0 && (
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>{jobStatus.progress.orders} Orders</span>
                  </div>
                )}
                {jobStatus.progress?.purchases > 0 && (
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>{jobStatus.progress.purchases} Purchases</span>
                  </div>
                )}
                {jobStatus.progress?.returns > 0 && (
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>{jobStatus.progress.returns} Returns</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'done' && jobStatus && (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex gap-3">
                <Check className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-emerald-900">Clone completed!</p>
                  <p className="text-sm text-emerald-700 mt-1">{formData.name} is ready to use</p>
                </div>
              </div>

              <div className="bg-slate-50 p-4 rounded-lg space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">Stores:</span>
                  <span className="font-medium">{jobStatus.progress?.stores || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Suppliers:</span>
                  <span className="font-medium">{jobStatus.progress?.suppliers || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">SKUs:</span>
                  <span className="font-medium">{jobStatus.progress?.skus || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Orders:</span>
                  <span className="font-medium">{jobStatus.progress?.orders || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Purchases:</span>
                  <span className="font-medium">{jobStatus.progress?.purchases || 0}</span>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button
                  onClick={handleReset}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600" />
              Confirm Clone
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will create a new workspace "{formData.name}" with a copy of selected data from "{workspace.name}".
              This process may take a few moments.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleStartClone}
              disabled={cloning || !formData.name.trim()}
              className="bg-indigo-600"
            >
              {cloning ? 'Starting...' : 'Start Clone'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}