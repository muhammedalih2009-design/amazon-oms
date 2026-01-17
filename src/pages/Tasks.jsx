import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/hooks/useTenant';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Plus, CheckSquare } from 'lucide-react';
import AddTaskModal from '@/components/tasks/AddTaskModal';
import TaskDetailModal from '@/components/tasks/TaskDetailModal';
import TaskCard from '@/components/tasks/TaskCard';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PagePermissionGuard from '@/components/shared/PagePermissionGuard';

const TAGS = ['Returns', 'Shipping', 'Inventory', 'Orders', 'Suppliers', 'General'];

export default function TasksPage() {
  const { tenantId, user, isAdmin, loading: tenantLoading } = useTenant();
  const [tasks, setTasks] = useState([]);
  const [comments, setComments] = useState({});
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    if (!tenantLoading && tenantId) {
      loadTasks();
    }
  }, [tenantId, tenantLoading]);

  const loadTasks = async () => {
    setLoading(true);
    try {
      let taskList;
      
      if (isAdmin) {
        // Admins see all tasks in their tenant
        taskList = await base44.entities.Task.filter({ tenant_id: tenantId }, '-created_date');
      } else {
        // Regular users only see tasks assigned to them
        taskList = await base44.entities.Task.filter({ 
          tenant_id: tenantId,
          assigned_to: user.id 
        }, '-created_date');
      }

      setTasks(taskList);

      // Load comment counts
      const commentCounts = {};
      for (const task of taskList) {
        const taskComments = await base44.entities.TaskComment.filter({ task_id: task.id });
        commentCounts[task.id] = taskComments.length;
      }
      setComments(commentCounts);
    } catch (error) {
      console.error('Error loading tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredTasks = tasks.filter(task => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'active') return task.status !== 'Completed';
    return task.status === statusFilter;
  });

  const tasksByTag = TAGS.reduce((acc, tag) => {
    acc[tag] = filteredTasks.filter(task => task.tag === tag);
    return acc;
  }, {});

  if (tenantLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <PagePermissionGuard pageKey="tasks">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Tasks</h1>
            <p className="text-slate-500 mt-1">
              {isAdmin ? 'Manage and assign tasks to your team' : 'View and update your assigned tasks'}
            </p>
          </div>
          {isAdmin && (
            <Button onClick={() => setShowAddModal(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Task
            </Button>
          )}
        </div>

        {/* Status Filter */}
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList>
            <TabsTrigger value="all">All Tasks</TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="New">New</TabsTrigger>
            <TabsTrigger value="In Progress">In Progress</TabsTrigger>
            <TabsTrigger value="Inquiry">Inquiry</TabsTrigger>
            <TabsTrigger value="Completed">Completed</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Task Board */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-48 bg-slate-100 animate-pulse rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {TAGS.map(tag => (
              tasksByTag[tag].length > 0 && (
                <div key={tag} className="space-y-3">
                  <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 rounded-lg">
                    <CheckSquare className="w-4 h-4 text-slate-600" />
                    <h2 className="font-semibold text-slate-900">{tag}</h2>
                    <span className="text-xs text-slate-500">({tasksByTag[tag].length})</span>
                  </div>
                  <div className="space-y-3">
                    {tasksByTag[tag].map(task => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onClick={() => setSelectedTask(task)}
                        commentCount={comments[task.id] || 0}
                      />
                    ))}
                  </div>
                </div>
              )
            ))}
          </div>
        )}

        {filteredTasks.length === 0 && !loading && (
          <div className="text-center py-12">
            <CheckSquare className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">No tasks found</h3>
            <p className="text-slate-500">
              {isAdmin ? 'Create your first task to get started' : 'You have no tasks assigned yet'}
            </p>
          </div>
        )}

        {/* Modals */}
        {isAdmin && (
          <AddTaskModal
            open={showAddModal}
            onClose={() => setShowAddModal(false)}
            onTaskCreated={loadTasks}
            tenantId={tenantId}
          />
        )}

        {selectedTask && (
          <TaskDetailModal
            open={!!selectedTask}
            onClose={() => setSelectedTask(null)}
            task={selectedTask}
            onUpdate={loadTasks}
            currentUser={user}
            isAdmin={isAdmin}
          />
        )}
      </div>
    </PagePermissionGuard>
  );
}