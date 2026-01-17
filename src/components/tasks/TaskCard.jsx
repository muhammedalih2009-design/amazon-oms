import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Calendar, User, MessageCircle, CheckSquare } from 'lucide-react';
import { format } from 'date-fns';
import { base44 } from '@/api/base44Client';

const STATUS_COLORS = {
  'New': 'bg-blue-100 text-blue-700 border-blue-300',
  'In Progress': 'bg-yellow-100 text-yellow-700 border-yellow-300',
  'Inquiry': 'bg-orange-100 text-orange-700 border-orange-300',
  'Completed': 'bg-green-100 text-green-700 border-green-300'
};

const PRIORITY_COLORS = {
  'Low': 'border-slate-300',
  'Medium': 'border-blue-400',
  'High': 'border-red-400'
};

export default function TaskCard({ task, onClick, commentCount = 0 }) {
  const [checklistProgress, setChecklistProgress] = useState({ completed: 0, total: 0 });
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'Completed';

  useEffect(() => {
    loadChecklistProgress();
  }, [task.id]);

  const loadChecklistProgress = async () => {
    try {
      const items = await base44.entities.TaskChecklistItem.filter({ task_id: task.id });
      const completed = items.filter(item => item.is_completed).length;
      setChecklistProgress({ completed, total: items.length });
    } catch (error) {
      console.error('Error loading checklist:', error);
    }
  };

  return (
    <Card
      className={`cursor-pointer hover:shadow-md transition-all border-l-4 ${PRIORITY_COLORS[task.priority]} ${
        isOverdue ? 'bg-red-50' : ''
      }`}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900 text-sm line-clamp-2 mb-1">
                {task.title}
              </h3>
              {task.account_name && (
                <Badge className="bg-purple-100 text-purple-700 text-xs">
                  {task.account_name}
                </Badge>
              )}
            </div>
            <Badge className={STATUS_COLORS[task.status]} style={{ fontSize: '10px' }}>
              {task.status}
            </Badge>
          </div>

          {/* Checklist Progress */}
          {checklistProgress.total > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1 text-slate-600">
                  <CheckSquare className="w-3 h-3" />
                  <span>{checklistProgress.completed}/{checklistProgress.total} tasks</span>
                </div>
                <span className="text-slate-500">
                  {Math.round((checklistProgress.completed / checklistProgress.total) * 100)}%
                </span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-1.5">
                <div 
                  className="h-1.5 rounded-full bg-green-500 transition-all"
                  style={{ width: `${(checklistProgress.completed / checklistProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Description Preview */}
          {task.description && !checklistProgress.total && (
            <p className="text-xs text-slate-600 line-clamp-2">{task.description}</p>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <Avatar className="w-6 h-6 bg-gradient-to-r from-indigo-600 to-violet-600">
                <AvatarFallback className="bg-transparent text-white text-xs">
                  {task.assigned_to_email?.charAt(0)?.toUpperCase() || 'U'}
                </AvatarFallback>
              </Avatar>
              <span className="text-xs text-slate-600 truncate max-w-[100px]">
                {task.assigned_to_email}
              </span>
            </div>

            <div className="flex items-center gap-3">
              {commentCount > 0 && (
                <div className="flex items-center gap-1 text-slate-500">
                  <MessageCircle className="w-3 h-3" />
                  <span className="text-xs">{commentCount}</span>
                </div>
              )}
              {task.due_date && (
                <div className={`flex items-center gap-1 ${isOverdue ? 'text-red-600' : 'text-slate-500'}`}>
                  <Calendar className="w-3 h-3" />
                  <span className="text-xs">
                    {format(new Date(task.due_date), 'MMM dd')}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}