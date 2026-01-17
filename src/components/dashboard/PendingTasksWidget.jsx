import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckSquare, Calendar, ArrowRight } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { createPageUrl } from '@/utils';
import { Link } from 'react-router-dom';

const STATUS_COLORS = {
  'New': 'bg-blue-100 text-blue-700',
  'In Progress': 'bg-yellow-100 text-yellow-700',
  'Inquiry': 'bg-orange-100 text-orange-700'
};

export default function PendingTasksWidget({ tenantId, userId }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPendingTasks();
  }, [tenantId, userId]);

  const loadPendingTasks = async () => {
    try {
      const allTasks = await base44.entities.Task.filter({
        tenant_id: tenantId,
        assigned_to: userId
      }, '-due_date');

      // Filter out completed tasks and take top 5
      const pendingTasks = allTasks
        .filter(task => task.status !== 'Completed')
        .slice(0, 5);

      setTasks(pendingTasks);
    } catch (error) {
      console.error('Error loading pending tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckSquare className="w-5 h-5" />
            My Pending Tasks
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-slate-100 animate-pulse rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CheckSquare className="w-5 h-5 text-indigo-600" />
            My Pending Tasks
          </CardTitle>
          <Link to={createPageUrl('Tasks')}>
            <Button variant="ghost" size="sm">
              View All
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <div className="text-center py-8">
            <CheckSquare className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No pending tasks</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => {
              const isOverdue = task.due_date && new Date(task.due_date) < new Date();
              return (
                <Link key={task.id} to={createPageUrl('Tasks')}>
                  <div className={`p-3 rounded-lg border transition-all hover:shadow-md cursor-pointer ${
                    isOverdue ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'
                  }`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h4 className="font-medium text-sm text-slate-900 line-clamp-1">
                        {task.title}
                      </h4>
                      <Badge className={STATUS_COLORS[task.status]} style={{ fontSize: '10px' }}>
                        {task.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-600">
                      <span className="px-2 py-0.5 bg-white rounded border border-slate-200">
                        {task.tag}
                      </span>
                      {task.due_date && (
                        <div className={`flex items-center gap-1 ${isOverdue ? 'text-red-600 font-semibold' : ''}`}>
                          <Calendar className="w-3 h-3" />
                          {format(new Date(task.due_date), 'MMM dd')}
                          {isOverdue && ' (Overdue)'}
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}