import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar, User, Tag, AlertCircle, Send, Clock, CheckSquare, Square } from 'lucide-react';
import { format } from 'date-fns';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { Checkbox } from '@/components/ui/checkbox';

const STATUS_COLORS = {
  'New': 'bg-blue-100 text-blue-700 border-blue-300',
  'In Progress': 'bg-yellow-100 text-yellow-700 border-yellow-300',
  'Inquiry': 'bg-orange-100 text-orange-700 border-orange-300',
  'Completed': 'bg-green-100 text-green-700 border-green-300'
};

const PRIORITY_COLORS = {
  'Low': 'bg-slate-100 text-slate-700',
  'Medium': 'bg-blue-100 text-blue-700',
  'High': 'bg-red-100 text-red-700'
};

export default function TaskDetailModal({ open, onClose, task, onUpdate, currentUser, isAdmin }) {
  const [comments, setComments] = useState([]);
  const [checklistItems, setChecklistItems] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [status, setStatus] = useState(task?.status || 'New');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open && task) {
      setStatus(task.status);
      loadComments();
      loadChecklistItems();
    }
  }, [open, task]);

  const loadComments = async () => {
    try {
      const taskComments = await base44.entities.TaskComment.filter(
        { task_id: task.id },
        '-created_date'
      );
      setComments(taskComments);
    } catch (error) {
      console.error('Error loading comments:', error);
    }
  };

  const loadChecklistItems = async () => {
    try {
      const items = await base44.entities.TaskChecklistItem.filter(
        { task_id: task.id },
        'order_index'
      );
      setChecklistItems(items);
    } catch (error) {
      console.error('Error loading checklist:', error);
    }
  };

  const handleToggleChecklistItem = async (itemId, currentStatus) => {
    try {
      await base44.entities.TaskChecklistItem.update(itemId, { 
        is_completed: !currentStatus 
      });
      await loadChecklistItems();
      
      // Check if all items are completed
      const updatedItems = await base44.entities.TaskChecklistItem.filter({ task_id: task.id });
      const allCompleted = updatedItems.every(item => item.is_completed);
      
      if (allCompleted && updatedItems.length > 0 && status !== 'Completed') {
        toast({
          title: 'All items completed!',
          description: 'Consider marking this task as Completed.',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update checklist item',
        variant: 'destructive'
      });
    }
  };

  const handleStatusChange = async (newStatus) => {
    try {
      await base44.entities.Task.update(task.id, { status: newStatus });
      setStatus(newStatus);
      onUpdate();
      
      toast({
        title: 'Status updated',
        description: `Task status changed to ${newStatus}`
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update status',
        variant: 'destructive'
      });
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;

    setLoading(true);
    try {
      await base44.entities.TaskComment.create({
        task_id: task.id,
        user_id: currentUser.id,
        user_email: currentUser.email,
        user_name: currentUser.full_name,
        comment_text: newComment
      });

      setNewComment('');
      await loadComments();
      
      toast({
        title: 'Comment added',
        description: 'Your comment has been posted'
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to add comment',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  if (!task) return null;

  const canChangeStatus = isAdmin || task.assigned_to === currentUser.id;
  const completedCount = checklistItems.filter(item => item.is_completed).length;
  const totalCount = checklistItems.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b sticky top-0 bg-white z-10">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <DialogTitle className="text-xl">{task.title}</DialogTitle>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <Badge className={STATUS_COLORS[status]}>{status}</Badge>
                <Badge className={PRIORITY_COLORS[task.priority]}>{task.priority} Priority</Badge>
                <Badge variant="outline">{task.tag}</Badge>
                {task.account_name && (
                  <Badge className="bg-purple-100 text-purple-700 border-purple-300">
                    {task.account_name}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 px-6 py-4 overflow-y-auto flex-1">
          {/* Task Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2 text-sm">
              <User className="w-4 h-4 text-slate-500" />
              <span className="text-slate-600">Assigned to:</span>
              <span className="font-medium">{task.assigned_to_email}</span>
            </div>
            {task.due_date && (
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="w-4 h-4 text-slate-500" />
                <span className="text-slate-600">Due:</span>
                <span className="font-medium">
                  {format(new Date(task.due_date), 'MMM dd, yyyy')}
                </span>
              </div>
            )}
          </div>

          {/* Checklist */}
          {checklistItems.length > 0 && (
            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                  <CheckSquare className="w-4 h-4" />
                  Checklist
                </h3>
                <span className="text-sm text-slate-600">
                  {completedCount}/{totalCount} completed
                </span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2 mb-3">
                <div 
                  className="h-2 rounded-full bg-green-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="space-y-2">
                {checklistItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 p-2 hover:bg-white rounded transition-colors">
                    <Checkbox
                      checked={item.is_completed}
                      onCheckedChange={() => handleToggleChecklistItem(item.id, item.is_completed)}
                      disabled={!canChangeStatus}
                    />
                    <span className={`text-sm flex-1 ${item.is_completed ? 'line-through text-slate-500' : 'text-slate-700'}`}>
                      {item.content}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          {task.description && (
            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
              <h3 className="font-semibold text-slate-900 mb-2">Additional Notes</h3>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          {/* Status Changer */}
          {canChangeStatus && (
            <div>
              <label className="text-sm font-medium text-slate-700 mb-2 block">
                Update Status
              </label>
              <Select value={status} onValueChange={handleStatusChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="New">New</SelectItem>
                  <SelectItem value="In Progress">In Progress</SelectItem>
                  <SelectItem value="Inquiry">Inquiry</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Comments Section */}
          <div className="border-t border-slate-200 pt-4">
            <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Send className="w-4 h-4" />
              Comments ({comments.length})
            </h3>

            {/* Comment List */}
            <div className="space-y-3 mb-4 max-h-60 overflow-y-auto">
              {comments.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">No comments yet</p>
              ) : (
                comments.map((comment) => (
                  <div key={comment.id} className="flex gap-3">
                    <Avatar className="w-8 h-8 bg-gradient-to-r from-indigo-600 to-violet-600">
                      <AvatarFallback className="bg-transparent text-white text-xs">
                        {comment.user_name?.charAt(0)?.toUpperCase() || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <div className="bg-slate-100 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm text-slate-900">
                            {comment.user_name || comment.user_email}
                          </span>
                          <span className="text-xs text-slate-500">
                            {format(new Date(comment.created_date), 'MMM dd, HH:mm')}
                          </span>
                        </div>
                        <p className="text-sm text-slate-700 whitespace-pre-wrap">
                          {comment.comment_text}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Add Comment */}
            <div className="flex gap-2">
              <Textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                className="flex-1"
                rows={2}
              />
              <Button
                onClick={handleAddComment}
                disabled={loading || !newComment.trim()}
                className="self-end"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}