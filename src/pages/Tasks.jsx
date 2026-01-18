import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/hooks/useTenant';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, CheckSquare, Search, Filter, Trash2, CheckCircle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
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
  const { tenantId, user, isAdmin, canEditPage, loading: tenantLoading } = useTenant();
  const canEdit = canEditPage('tasks');
  const [tasks, setTasks] = useState([]);
  const [comments, setComments] = useState({});
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [uniqueAccounts, setUniqueAccounts] = useState([]);

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

      // Extract unique account names
      const accounts = [...new Set(
        taskList
          .map(t => t.account_name)
          .filter(name => name && name.trim() !== '')
      )].sort();
      setUniqueAccounts(accounts);

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
    if (accountFilter !== 'all' && task.account_name !== accountFilter) {
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

  const { toast } = useToast();

  const handleToggleTask = (taskId) => {
    setSelectedTaskIds(prev => 
      prev.includes(taskId) 
        ? prev.filter(id => id !== taskId)
        : [...prev, taskId]
    );
  };

  const handleSelectAll = (tag) => {
    const tagTaskIds = tasksByTag[tag].map(t => t.id);
    const allSelected = tagTaskIds.every(id => selectedTaskIds.includes(id));
    
    if (allSelected) {
      setSelectedTaskIds(prev => prev.filter(id => !tagTaskIds.includes(id)));
    } else {
      setSelectedTaskIds(prev => [...new Set([...prev, ...tagTaskIds])]);
    }
  };

  const handleDeleteTasks = async () => {
    try {
      // Delete associated checklist items and comments
      for (const taskId of selectedTaskIds) {
        const checklistItems = await base44.entities.TaskChecklistItem.filter({ task_id: taskId });
        for (const item of checklistItems) {
          await base44.entities.TaskChecklistItem.delete(item.id);
        }

        const taskComments = await base44.entities.TaskComment.filter({ task_id: taskId });
        for (const comment of taskComments) {
          await base44.entities.TaskComment.delete(comment.id);
        }

        // Delete the task itself
        await base44.entities.Task.delete(taskId);
      }

      toast({
        title: 'Tasks deleted',
        description: `Successfully deleted ${selectedTaskIds.length} task${selectedTaskIds.length > 1 ? 's' : ''}`
      });

      setSelectedTaskIds([]);
      setShowDeleteDialog(false);
      loadTasks();
    } catch (error) {
      toast({
        title: 'Error deleting tasks',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleEditTask = (task) => {
    setEditingTask(task);
    setShowAddModal(true);
  };

  const handleCloseModal = () => {
    setShowAddModal(false);
    setEditingTask(null);
  };

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
            {canEdit && (
              <Button onClick={() => setShowAddModal(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create Task
              </Button>
            )}
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
              <Select value={accountFilter} onValueChange={setAccountFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Accounts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Accounts</SelectItem>
                  {uniqueAccounts.map((account) => (
                    <SelectItem key={account} value={account}>
                      {account}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
          {(searchQuery || accountFilter !== 'all' || (isAdmin && assigneeFilter !== 'all')) && (
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
              {accountFilter !== 'all' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAccountFilter('all')}
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
                  setAccountFilter('all');
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
                  <div className="flex items-center justify-between px-3 py-2 bg-slate-100 rounded-lg">
                    <div className="flex items-center gap-2">
                      <CheckSquare className="w-4 h-4 text-slate-600" />
                      <h2 className="font-semibold text-slate-900">{tag}</h2>
                      <span className="text-xs text-slate-500">({tasksByTag[tag].length})</span>
                    </div>
                    {isAdmin && tasksByTag[tag].length > 0 && (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={tasksByTag[tag].every(t => selectedTaskIds.includes(t.id))}
                          onCheckedChange={() => handleSelectAll(tag)}
                        />
                        <span className="text-xs text-slate-600">Select All</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-3">
                    {tasksByTag[tag].map(task => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onClick={() => setSelectedTask(task)}
                        commentCount={comments[task.id] || 0}
                        isAdmin={isAdmin}
                        isSelected={selectedTaskIds.includes(task.id)}
                        onToggleSelect={() => handleToggleTask(task.id)}
                        canEdit={canEdit}
                        onEdit={handleEditTask}
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
        {canEdit && (
          <AddTaskModal
            open={showAddModal}
            onClose={handleCloseModal}
            onTaskCreated={() => {
              loadTasks();
              toast({
                title: 'Success',
                description: editingTask ? 'Task updated successfully' : 'Task created successfully'
              });
            }}
            tenantId={tenantId}
            editTask={editingTask}
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
            onEdit={handleEditTask}
          />
        )}

        {/* Bulk Action Bar */}
        {isAdmin && selectedTaskIds.length > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
            <div className="bg-slate-900 text-white rounded-full shadow-2xl px-6 py-4 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-400" />
                <span className="font-semibold">
                  {selectedTaskIds.length} Task{selectedTaskIds.length > 1 ? 's' : ''} Selected
                </span>
              </div>
              <div className="w-px h-6 bg-slate-700" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedTaskIds([])}
                className="text-white hover:bg-slate-800"
              >
                Clear
              </Button>
              <Button
                size="sm"
                onClick={() => setShowDeleteDialog(true)}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Selected
              </Button>
            </div>
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Tasks?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete {selectedTaskIds.length} task{selectedTaskIds.length > 1 ? 's' : ''}? 
                This will also remove all associated checklist items and comments. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleDeleteTasks}
                className="bg-red-600 hover:bg-red-700"
              >
                Delete Tasks
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </PagePermissionGuard>
  );
}