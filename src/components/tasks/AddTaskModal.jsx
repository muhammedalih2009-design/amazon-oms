import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Plus, X } from 'lucide-react';
import { format } from 'date-fns';
import { base44 } from '@/api/base44Client';

const TAGS = ['Returns', 'Shipping', 'Inventory', 'Orders', 'Suppliers', 'General'];
const PRIORITIES = ['Low', 'Medium', 'High'];

export default function AddTaskModal({ open, onClose, onTaskCreated, tenantId }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [accountName, setAccountName] = useState('');
  const [checklistItems, setChecklistItems] = useState([]);
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [tag, setTag] = useState('General');
  const [priority, setPriority] = useState('Medium');
  const [dueDate, setDueDate] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      loadMembers();
    }
  }, [open]);

  const loadMembers = async () => {
    try {
      const memberships = await base44.entities.Membership.filter({ tenant_id: tenantId });
      setMembers(memberships);
    } catch (error) {
      console.error('Error loading members:', error);
    }
  };

  const handleAddChecklistItem = () => {
    if (!newChecklistItem.trim()) return;
    setChecklistItems([...checklistItems, newChecklistItem.trim()]);
    setNewChecklistItem('');
  };

  const handleRemoveChecklistItem = (index) => {
    setChecklistItems(checklistItems.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const currentUser = await base44.auth.me();
      const selectedMember = members.find(m => m.user_id === assignedTo);

      const task = await base44.entities.Task.create({
        tenant_id: tenantId,
        title,
        description,
        account_name: accountName || null,
        assigned_to: assignedTo,
        assigned_to_email: selectedMember?.user_email,
        created_by: currentUser.id,
        created_by_email: currentUser.email,
        tag,
        priority,
        status: 'New',
        due_date: dueDate ? format(dueDate, 'yyyy-MM-dd') : null
      });

      // Create checklist items
      for (let i = 0; i < checklistItems.length; i++) {
        await base44.entities.TaskChecklistItem.create({
          task_id: task.id,
          content: checklistItems[i],
          is_completed: false,
          order_index: i
        });
      }

      // Reset form
      setTitle('');
      setDescription('');
      setAccountName('');
      setChecklistItems([]);
      setNewChecklistItem('');
      setAssignedTo('');
      setTag('General');
      setPriority('Medium');
      setDueDate(null);

      onTaskCreated();
      onClose();
    } catch (error) {
      console.error('Error creating task:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>Create New Task</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="title">Task Title *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Process return for Order #12345"
                required
                className="mt-2"
              />
            </div>

            <div>
              <Label htmlFor="accountName">Account Name</Label>
              <Input
                id="accountName"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="e.g., Amazon Store A, Client XYZ"
                className="mt-2"
              />
            </div>

            <div>
              <Label htmlFor="description">Description (Optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add additional context..."
                className="mt-2 h-20"
              />
            </div>

            <div>
              <Label>Checklist Items</Label>
              <div className="mt-2 space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={newChecklistItem}
                    onChange={(e) => setNewChecklistItem(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddChecklistItem())}
                    placeholder="Add a checklist item..."
                  />
                  <Button type="button" onClick={handleAddChecklistItem} size="sm">
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                {checklistItems.length > 0 && (
                  <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 space-y-2">
                    {checklistItems.map((item, index) => (
                      <div key={index} className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex-1">{item}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleRemoveChecklistItem(index)}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="assignee">Assign To *</Label>
                <Select value={assignedTo} onValueChange={setAssignedTo} required>
                  <SelectTrigger className="mt-2">
                    <SelectValue placeholder="Select team member" />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((member) => (
                      <SelectItem key={member.id} value={member.user_id}>
                        {member.user_email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="tag">Category *</Label>
                <Select value={tag} onValueChange={setTag}>
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TAGS.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="priority">Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Due Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full mt-2 justify-start">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dueDate ? format(dueDate, 'PPP') : 'Pick a date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={dueDate}
                      onSelect={setDueDate}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}