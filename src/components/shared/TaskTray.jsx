import React, { useState } from 'react';
import { useTaskManager } from '@/components/hooks/useTaskManager';
import { CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function TaskTray() {
  const { tasks, activeTasks, completedTasks, showTask, removeTask } = useTaskManager();
  const [isExpanded, setIsExpanded] = useState(false);

  if (tasks.length === 0) return null;

  const getStatusIcon = (status) => {
    switch (status) {
      case 'running':
        return <Loader2 className="w-4 h-4 animate-spin text-blue-600" />;
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-green-600" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-600" />;
      default:
        return null;
    }
  };

  const getProgressPercent = (task) => {
    if (task.progress.total === 0) return 0;
    return Math.round((task.progress.current / task.progress.total) * 100);
  };

  return (
    <div className="fixed bottom-6 right-6 z-[100] w-96 max-w-[calc(100vw-3rem)]">
      {/* Collapsed Header */}
      <Card className="bg-white shadow-2xl border-2 border-indigo-200">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            {activeTasks.length > 0 ? (
              <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            )}
            <div className="text-left">
              <p className="font-semibold text-sm text-slate-900">
                Task Manager
              </p>
              <p className="text-xs text-slate-500">
                {activeTasks.length} running, {completedTasks.length} completed
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeTasks.length > 0 && (
              <Badge className="bg-blue-100 text-blue-700">
                {activeTasks.length}
              </Badge>
            )}
            {isExpanded ? (
              <ChevronDown className="w-5 h-5 text-slate-400" />
            ) : (
              <ChevronUp className="w-5 h-5 text-slate-400" />
            )}
          </div>
        </button>

        {/* Expanded Task List */}
        {isExpanded && (
          <div className="border-t max-h-96 overflow-y-auto">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="p-4 border-b last:border-b-0 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-start gap-2 flex-1">
                    {getStatusIcon(task.status)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {task.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {task.progress.current} / {task.progress.total} items
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {task.status !== 'running' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTask(task.id);
                        }}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                {task.status === 'running' && (
                  <Progress value={getProgressPercent(task)} className="h-2 mb-2" />
                )}

                {/* Stats */}
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-green-600">
                    ✓ {task.progress.successCount}
                  </span>
                  {task.progress.failCount > 0 && (
                    <span className="text-red-600">
                      ✗ {task.progress.failCount}
                    </span>
                  )}
                  {task.status !== 'running' && task.completedAt && (
                    <span className="text-slate-400 ml-auto">
                      {new Date(task.completedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>

                {/* View Details Button */}
                {!task.modalVisible && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-3"
                    onClick={() => showTask(task.id)}
                  >
                    View Details
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}