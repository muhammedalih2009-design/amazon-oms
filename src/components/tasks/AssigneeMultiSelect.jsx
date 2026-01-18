import React, { useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';

export default function AssigneeMultiSelect({ members, selectedIds, onChange, label = 'Filter by Assignee' }) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredMembers = members.filter(member =>
    member.user_email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleMember = (userId) => {
    if (selectedIds.includes(userId)) {
      onChange(selectedIds.filter(id => id !== userId));
    } else {
      onChange([...selectedIds, userId]);
    }
  };

  const clearAll = () => {
    onChange([]);
    setSearchQuery('');
  };

  const getDisplayLabel = () => {
    if (selectedIds.length === 0) {
      return 'All Members';
    } else if (selectedIds.length === 1) {
      const member = members.find(m => m.user_id === selectedIds[0]);
      return member?.user_email || 'All Members';
    } else {
      return `${selectedIds.length} Members Selected`;
    }
  };

  return (
    <div>
      <label className="text-sm font-medium text-slate-700 mb-2 block flex items-center gap-2">
        {label}
        {selectedIds.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {selectedIds.length}
          </Badge>
        )}
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
          >
            <span className="truncate">{getDisplayLabel()}</span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          <div className="p-2 border-b border-slate-200">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search members..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
          </div>
          <div className="max-h-[300px] overflow-y-auto p-2">
            {/* Clear All Option */}
            <div
              className="flex items-center gap-2 px-3 py-2 hover:bg-slate-100 rounded-md cursor-pointer"
              onClick={clearAll}
            >
              {selectedIds.length === 0 ? (
                <Check className="w-4 h-4 text-indigo-600" />
              ) : (
                <div className="w-4 h-4" />
              )}
              <span className="text-sm font-medium text-slate-900">All Members</span>
            </div>

            {/* Member List */}
            {filteredMembers.length > 0 ? (
              filteredMembers.map((member) => {
                const isSelected = selectedIds.includes(member.user_id);
                return (
                  <div
                    key={member.user_id}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-slate-100 rounded-md cursor-pointer"
                    onClick={() => toggleMember(member.user_id)}
                  >
                    <Checkbox checked={isSelected} className="pointer-events-none" />
                    <span className="text-sm text-slate-900 flex-1 truncate">
                      {member.user_email}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="px-3 py-6 text-center text-sm text-slate-500">
                No members found
              </div>
            )}
          </div>
          {selectedIds.length > 0 && (
            <div className="p-2 border-t border-slate-200">
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="w-full text-xs"
              >
                <X className="w-3 h-3 mr-1" />
                Clear Selection
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}