import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, X } from 'lucide-react';

export default function TaskProgressModal({
  open,
  onClose,
  title,
  current,
  total,
  successCount,
  failCount,
  completed,
  log = [],
  allowClose = true
}) {
  const progress = total > 0 ? (current / total) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={(open) => {
      if (!open && completed && allowClose) {
        onClose();
      }
    }}>
      <DialogContent className="sm:max-w-2xl" hideClose={!completed || !allowClose}>
        <DialogHeader className="flex items-center justify-between">
          <DialogTitle>
            {completed ? `${title} - Complete!` : title}
          </DialogTitle>
          {completed && allowClose && (
            <button
              onClick={onClose}
              className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground cursor-pointer"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </button>
          )}
        </DialogHeader>
        <div className="space-y-4 py-4">
          {/* Live Counter */}
          {!completed && current > 0 && (
            <div className="text-center">
              <p className="text-sm text-indigo-600 font-medium animate-pulse">
                Processing {current} of {total}...
              </p>
            </div>
          )}

          {/* Status Label */}
          <div className="text-center">
            <p className="text-lg font-semibold text-slate-900">
              {current} of {total} Items
            </p>
            <p className="text-sm text-slate-500 mt-1">
              {Math.round(progress)}% Complete
            </p>
          </div>

          {/* Progress Bar */}
          <div className="relative w-full h-3 bg-slate-200 rounded-full overflow-hidden">
            <div 
              className="absolute top-0 left-0 h-full bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Stats Breakdown */}
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <div>
                  <p className="text-xs text-emerald-700 font-medium">Success</p>
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
                        <span className="font-medium">{entry.label}</span>
                        {entry.success ? (
                          entry.details && (
                            <span className="text-emerald-600 ml-2 text-xs block">
                              {entry.details}
                            </span>
                          )
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
                Successfully processed <strong>{successCount}</strong> item(s).
                {failCount > 0 && (
                  <> <strong>{failCount}</strong> failed.</>
                )}
              </p>
            </div>
          )}

          {/* Completion Actions */}
          {completed && allowClose && (
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