import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/hooks/useTenant';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, CheckSquare, Search, Filter } from 'lucide-react';
import AddTaskModal from '@/components/tasks/AddTaskModal';
import TaskDetailModal from '@/components/tasks/TaskDetailModal';
import TaskCard from '@/components/tasks/TaskCard';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import PagePermissionGuard from '@/components/shared/PagePermissionGuard';

const TAGS = ['Returns', 'Shipping', 'Inventory', 'Orders', 'Suppliers', 'General'];

export default function TasksPage() {
  const { tenantId, user, isAdmin, loading: tenantLoading } = useTenant();
  const [tasks, setTasks] = useState([]);
  const [comments, setComments] = useState({});
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [accountFilter, setAccountFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!tenantLoading && tenantId) {
      loadTasks();
      loadMembers();
    }
  }, [tenantId, tenantLoading]);

  const loadMembers = async () => {
    try {
      const memberships = await base44.entities.Membership.filter({ tenant_id: tenantId });
      setMembers(memberships);
    } catch (error) {
      console.error('Error loading members:', error);
    }
  };

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
    // Status filter
    if (statusFilter !== 'all') {
      if (statusFilter === 'active' && task.status === 'Completed') return false;
      if (statusFilter !== 'active' && task.status !== statusFilter) return false;
    }

    // Assignee filter (admin only)
    if (isAdmin && assigneeFilter !== 'all' && task.assigned_to !== assigneeFilter) {
      return false;
    }

    // Account filter
    if (accountFilter.trim() && !task.account_name?.toLowerCase().includes(accountFilter.toLowerCase())) {
      return false;
    }

    // Search query (title or description)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const matchesTitle = task.title?.toLowerCase().includes(query);
      const matchesDescription = task.description?.toLowerCase().includes(query);
      if (!matchesTitle && !matchesDescription) return false;
    }

    return true;
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

        {/* Status Filter Tabs */}
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

        {/* Advanced Filters */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4 text-slate-600" />
            <h3 className="font-semibold text-slate-900">Filters</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Search */}
            <div>
              <label className="text-sm font-medium text-slate-700 mb-2 block">
                Search
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search by title or description..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Account Filter */}
            <div>
              <label className="text-sm font-medium text-slate-700 mb-2 block">
                Filter by Account
              </label>
              <Input
                placeholder="Enter account name..."
                value={accountFilter}
                onChange={(e) => setAccountFilter(e.target.value)}
              />
            </div>

            {/* Assignee Filter (Admin Only) */}
            {isAdmin && (
              <div>
                <label className="text-sm font-medium text-slate-700 mb-2 block">
                  Filter by Assignee
                </label>
                <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Members" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Members</SelectItem>
                    {members.map((member) => (
                      <SelectItem key={member.user_id} value={member.user_id}>
                        {member.user_email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Active Filters Summary */}
          {(searchQuery || accountFilter || (isAdmin && assigneeFilter !== 'all')) && (
            <div className="mt-3 pt-3 border-t border-slate-200 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-600">Active filters:</span>
              {searchQuery && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSearchQuery('')}
                  className="h-7 text-xs"
                >
                  Search: "{searchQuery}" ×
                </Button>
              )}
              {accountFilter && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAccountFilter('')}
                  className="h-7 text-xs"
                >
                  Account: "{accountFilter}" ×
                </Button>
              )}
              {isAdmin && assigneeFilter !== 'all' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAssigneeFilter('all')}
                  className="h-7 text-xs"
                >
                  Assignee: {members.find(m => m.user_id === assigneeFilter)?.user_email} ×
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setAccountFilter('');
                  setAssigneeFilter('all');
                }}
                className="h-7 text-xs text-slate-600"
              >
                Clear all
              </Button>
            </div>
          )}
        </div>

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