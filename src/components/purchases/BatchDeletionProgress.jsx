import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

export default function BatchDeletionProgress({ 
  open, 
  batch, 
  progressState,
  onClose 
}) {
  const { current, total, successCount, failCount, completed, log } = progressState;
  const progressPercent = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen && completed) {
        onClose();
      }
    }}>
      <DialogContent className="sm:max-w-2xl" hideClose={!completed}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {!completed && <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />}
            {completed ? 'Batch Deletion Complete' : `Deleting Batch: ${batch?.batch_name || 'Purchase Batch'}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Warning Banner */}
          {!completed && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-orange-900">
                  Please do not close this window
                </p>
                <p className="text-xs text-orange-700 mt-1">
                  Reverting stock changes and removing purchase records...
                </p>
              </div>
            </div>
          )}

          {/* Live Counter */}
          {!completed && current > 0 && (
            <div className="text-center">
              <p className="text-sm text-indigo-600 font-medium animate-pulse">
                Removing item {current} of {total}...
              </p>
            </div>
          )}

          {/* Progress Stats */}
          <div className="text-center">
            <p className="text-lg font-semibold text-slate-900">
              {current} of {total} Items
            </p>
            <p className="text-sm text-slate-500 mt-1">
              {progressPercent}% Complete
            </p>
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <Progress value={progressPercent} className="h-3" />
          </div>

          {/* Success/Fail Breakdown */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <div>
                  <p className="text-xs text-emerald-700 font-medium">Deleted</p>
                  <p className="text-2xl font-bold text-emerald-900">{successCount}</p>
                </div>
              </div>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <XCircle className="w-5 h-5 text-red-600" />
                <div>
                  <p className="text-xs text-red-700 font-medium">Failed</p>
                  <p className="text-2xl font-bold text-red-900">{failCount}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Activity Log */}
          {log.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Recent Activity</p>
              <div className="bg-slate-50 rounded-lg border border-slate-200 max-h-48 overflow-y-auto">
                <div className="p-3 space-y-2">
                  {log.map((entry, idx) => (
                    <div 
                      key={idx}
                      className={`flex items-start gap-2 text-sm ${
                        entry.success ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {entry.success ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">{entry.skuCode}</span>
                        {entry.success ? (
                          <span className="text-emerald-600 ml-2 text-xs block">
                            {entry.details || 'Deleted & stock reverted'}
                          </span>
                        ) : (
                          <span className="text-red-600 ml-2 text-xs block">
                            {entry.error || 'Failed'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Completion Summary */}
          {completed && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
              <p className="font-semibold text-indigo-900 mb-1">Summary</p>
              <p className="text-sm text-indigo-700">
                Successfully deleted <strong>{successCount}</strong> purchase record(s) and reverted stock changes.
                {failCount > 0 && (
                  <> <strong>{failCount}</strong> failed.</>
                )}
              </p>
            </div>
          )}

          {/* Done Button */}
          {completed && (
            <div className="pt-2">
              <Button 
                onClick={onClose}
                className="w-full bg-indigo-600 hover:bg-indigo-700"
              >
                Done
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}