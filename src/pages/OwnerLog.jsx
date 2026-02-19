import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Plus, ListChecks, BookOpen, Pin, MessageSquare, Clock } from 'lucide-react';
import { format } from 'date-fns';
import ReactMarkdown from 'react-markdown';

const APP_OWNER_EMAIL = 'muhammedalih.2009@gmail.com';

export default function OwnerLog() {
  const { user } = useTenant();
  const [tasks, setTasks] = useState([]);
  const [preferences, setPreferences] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Task state
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [selectedTask, setSelectedTask] = useState(null);
  const [taskUpdates, setTaskUpdates] = useState([]);
  const [newComment, setNewComment] = useState('');
  
  // New task modal
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'P2',
    area: 'Other'
  });

  // Preference editor
  const [editingPreference, setEditingPreference] = useState(null);
  const [showPreferenceEditor, setShowPreferenceEditor] = useState(false);

  // Access control
  const isAppOwner = user?.email?.toLowerCase() === APP_OWNER_EMAIL.toLowerCase();

  useEffect(() => {
    if (isAppOwner) {
      loadData();
    }
  }, [isAppOwner, statusFilter, priorityFilter, areaFilter]);

  const loadData = async () => {
    try {
      const [tasksRes, prefsRes] = await Promise.all([
        base44.functions.invoke('ownerLog/listTasks', { status: statusFilter, priority: priorityFilter, area: areaFilter }),
        base44.functions.invoke('ownerLog/listPreferences', {})
      ]);
      
      setTasks(tasksRes.data.tasks || []);
      setPreferences(prefsRes.data.preferences || []);
    } catch (error) {
      console.error('Failed to load owner log data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTaskUpdates = async (taskId) => {
    try {
      const updates = await base44.entities.OwnerTaskUpdate.filter({ task_id: taskId }, '-created_date');
      setTaskUpdates(updates);
    } catch (error) {
      console.error('Failed to load task updates:', error);
    }
  };

  const handleCreateTask = async () => {
    try {
      await base44.functions.invoke('ownerLog/createTask', newTask);
      setShowNewTask(false);
      setNewTask({ title: '', description: '', priority: 'P2', area: 'Other' });
      loadData();
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  };

  const handleUpdateTaskStatus = async (taskId, newStatus) => {
    try {
      await base44.functions.invoke('ownerLog/updateTask', {
        task_id: taskId,
        updates: { status: newStatus }
      });
      loadData();
      if (selectedTask?.id === taskId) {
        loadTaskUpdates(taskId);
      }
    } catch (error) {
      console.error('Failed to update task:', error);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || !selectedTask) return;
    
    try {
      await base44.functions.invoke('ownerLog/addTaskUpdate', {
        task_id: selectedTask.id,
        message: newComment,
        update_type: 'comment'
      });
      setNewComment('');
      loadTaskUpdates(selectedTask.id);
    } catch (error) {
      console.error('Failed to add comment:', error);
    }
  };

  const handleSavePreference = async () => {
    try {
      await base44.functions.invoke('ownerLog/savePreference', editingPreference);
      setShowPreferenceEditor(false);
      setEditingPreference(null);
      loadData();
    } catch (error) {
      console.error('Failed to save preference:', error);
    }
  };

  const openTaskDrawer = (task) => {
    setSelectedTask(task);
    loadTaskUpdates(task.id);
  };

  if (!isAppOwner) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-2">Access Denied</h2>
          <p className="text-slate-600">This area is restricted to the app owner.</p>
        </Card>
      </div>
    );
  }

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  const priorityColors = {
    P0: 'bg-red-100 text-red-800',
    P1: 'bg-orange-100 text-orange-800',
    P2: 'bg-blue-100 text-blue-800',
    P3: 'bg-slate-100 text-slate-800'
  };

  const statusColors = {
    'Backlog': 'bg-slate-100 text-slate-800',
    'In Progress': 'bg-blue-100 text-blue-800',
    'Blocked': 'bg-red-100 text-red-800',
    'Done': 'bg-green-100 text-green-800'
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Owner Log</h1>
          <p className="text-slate-600 mt-1">Private workspace for app owner</p>
        </div>
      </div>

      <Tabs defaultValue="tasks" className="w-full">
        <TabsList>
          <TabsTrigger value="tasks">
            <ListChecks className="w-4 h-4 mr-2" />
            Tasks
          </TabsTrigger>
          <TabsTrigger value="preferences">
            <BookOpen className="w-4 h-4 mr-2" />
            Preferences
          </TabsTrigger>
        </TabsList>

        {/* Tasks Tab */}
        <TabsContent value="tasks" className="space-y-4">
          {/* Filters */}
          <Card className="p-4">
            <div className="flex gap-4">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>All Status</SelectItem>
                  <SelectItem value="Backlog">Backlog</SelectItem>
                  <SelectItem value="In Progress">In Progress</SelectItem>
                  <SelectItem value="Blocked">Blocked</SelectItem>
                  <SelectItem value="Done">Done</SelectItem>
                </SelectContent>
              </Select>

              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="All Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>All Priority</SelectItem>
                  <SelectItem value="P0">P0</SelectItem>
                  <SelectItem value="P1">P1</SelectItem>
                  <SelectItem value="P2">P2</SelectItem>
                  <SelectItem value="P3">P3</SelectItem>
                </SelectContent>
              </Select>

              <Select value={areaFilter} onValueChange={setAreaFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="All Areas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>All Areas</SelectItem>
                  <SelectItem value="Invites">Invites</SelectItem>
                  <SelectItem value="Backup">Backup</SelectItem>
                  <SelectItem value="i18n">i18n</SelectItem>
                  <SelectItem value="Currency">Currency</SelectItem>
                  <SelectItem value="Performance">Performance</SelectItem>
                  <SelectItem value="UI">UI</SelectItem>
                  <SelectItem value="Security">Security</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>

              <Button onClick={() => setShowNewTask(true)} className="ml-auto">
                <Plus className="w-4 h-4 mr-2" />
                New Task
              </Button>
            </div>
          </Card>

          {/* Tasks List */}
          <div className="grid gap-3">
            {tasks.map(task => (
              <Card key={task.id} className="p-4 cursor-pointer hover:border-indigo-300 transition-colors" onClick={() => openTaskDrawer(task)}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className={priorityColors[task.priority]}>{task.priority}</Badge>
                      <Badge className={statusColors[task.status]}>{task.status}</Badge>
                      <Badge variant="outline">{task.area}</Badge>
                    </div>
                    <h3 className="font-semibold text-slate-900">{task.title}</h3>
                    <p className="text-sm text-slate-600 mt-1">{task.description}</p>
                  </div>
                  <div className="flex gap-2">
                    {task.status !== 'Done' && (
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handleUpdateTaskStatus(task.id, 'Done'); }}>
                        Mark Done
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Preferences Tab */}
        <TabsContent value="preferences" className="space-y-4">
          <Button onClick={() => { setEditingPreference({ key: '', title: '', content_markdown: '', pinned: false }); setShowPreferenceEditor(true); }}>
            <Plus className="w-4 h-4 mr-2" />
            New Preference
          </Button>

          {/* Pinned preferences */}
          {preferences.filter(p => p.pinned).length > 0 && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Pin className="w-5 h-5 text-amber-500" />
                Quick Rules (Pinned)
              </h3>
              {preferences.filter(p => p.pinned).map(pref => (
                <Card key={pref.id} className="p-4 cursor-pointer hover:border-indigo-300" onClick={() => { setEditingPreference(pref); setShowPreferenceEditor(true); }}>
                  <h4 className="font-semibold text-slate-900 mb-2">{pref.title}</h4>
                  <div className="prose prose-sm max-w-none text-slate-600">
                    <ReactMarkdown>{pref.content_markdown}</ReactMarkdown>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* All preferences */}
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-slate-900">All Preferences</h3>
            {preferences.map(pref => (
              <Card key={pref.id} className="p-4 cursor-pointer hover:border-indigo-300" onClick={() => { setEditingPreference(pref); setShowPreferenceEditor(true); }}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-semibold text-slate-900">{pref.title}</h4>
                    <p className="text-sm text-slate-600 mt-1 line-clamp-2">{pref.content_markdown}</p>
                  </div>
                  {pref.pinned && <Pin className="w-4 h-4 text-amber-500" />}
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Task Drawer */}
      <Sheet open={!!selectedTask} onOpenChange={() => setSelectedTask(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {selectedTask && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedTask.title}</SheetTitle>
                <SheetDescription>{selectedTask.description}</SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                {/* Status controls */}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleUpdateTaskStatus(selectedTask.id, 'In Progress')}>
                    In Progress
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleUpdateTaskStatus(selectedTask.id, 'Blocked')}>
                    Blocked
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleUpdateTaskStatus(selectedTask.id, 'Done')}>
                    Done
                  </Button>
                </div>

                {/* Timeline */}
                <div>
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Timeline
                  </h3>
                  <div className="space-y-3">
                    {taskUpdates.map(update => (
                      <div key={update.id} className="border-l-2 border-slate-200 pl-4">
                        <div className="flex items-start gap-2">
                          <MessageSquare className="w-4 h-4 text-slate-400 mt-1" />
                          <div className="flex-1">
                            <p className="text-sm text-slate-900">{update.message}</p>
                            <p className="text-xs text-slate-500 mt-1">
                              {format(new Date(update.created_date), 'MMM d, yyyy h:mm a')}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Add comment */}
                <div>
                  <Label>Add Comment</Label>
                  <Textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Add a comment..."
                    rows={3}
                  />
                  <Button onClick={handleAddComment} className="mt-2" size="sm">
                    Add Comment
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* New Task Modal */}
      <Sheet open={showNewTask} onOpenChange={setShowNewTask}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>New Task</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div>
              <Label>Title</Label>
              <Input value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={newTask.description} onChange={(e) => setNewTask({ ...newTask, description: e.target.value })} rows={4} />
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={newTask.priority} onValueChange={(val) => setNewTask({ ...newTask, priority: val })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="P0">P0 - Critical</SelectItem>
                  <SelectItem value="P1">P1 - High</SelectItem>
                  <SelectItem value="P2">P2 - Medium</SelectItem>
                  <SelectItem value="P3">P3 - Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Area</Label>
              <Select value={newTask.area} onValueChange={(val) => setNewTask({ ...newTask, area: val })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Invites">Invites</SelectItem>
                  <SelectItem value="Backup">Backup</SelectItem>
                  <SelectItem value="i18n">i18n</SelectItem>
                  <SelectItem value="Currency">Currency</SelectItem>
                  <SelectItem value="Performance">Performance</SelectItem>
                  <SelectItem value="UI">UI</SelectItem>
                  <SelectItem value="Security">Security</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleCreateTask} className="w-full">Create Task</Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Preference Editor */}
      <Sheet open={showPreferenceEditor} onOpenChange={setShowPreferenceEditor}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{editingPreference?.id ? 'Edit' : 'New'} Preference</SheetTitle>
          </SheetHeader>
          {editingPreference && (
            <div className="mt-6 space-y-4">
              {!editingPreference.id && (
                <div>
                  <Label>Key</Label>
                  <Input value={editingPreference.key} onChange={(e) => setEditingPreference({ ...editingPreference, key: e.target.value })} />
                </div>
              )}
              <div>
                <Label>Title</Label>
                <Input value={editingPreference.title} onChange={(e) => setEditingPreference({ ...editingPreference, title: e.target.value })} />
              </div>
              <div>
                <Label>Content (Markdown)</Label>
                <Textarea value={editingPreference.content_markdown} onChange={(e) => setEditingPreference({ ...editingPreference, content_markdown: e.target.value })} rows={10} />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editingPreference.pinned}
                  onChange={(e) => setEditingPreference({ ...editingPreference, pinned: e.target.checked })}
                  className="w-4 h-4"
                />
                <Label>Pin to top</Label>
              </div>
              <Button onClick={handleSavePreference} className="w-full">Save Preference</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}