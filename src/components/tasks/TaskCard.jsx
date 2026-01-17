import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Calendar, User, MessageCircle } from 'lucide-react';
import { format } from 'date-fns';

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
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'Completed';

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
            <h3 className="font-semibold text-slate-900 text-sm line-clamp-2">
              {task.title}
            </h3>
            <Badge className={STATUS_COLORS[task.status]} style={{ fontSize: '10px' }}>
              {task.status}
            </Badge>
          </div>

          {/* Description Preview */}
          {task.description && (
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