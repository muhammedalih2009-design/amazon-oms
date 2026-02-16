import React from 'react';
import { Button } from '@/components/ui/button';
import { Calendar, X, Store } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { format, subDays } from 'date-fns';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

export default function SettlementFilters({ 
  dateRange, 
  onDateRangeChange, 
  selectedStoreIds, 
  onStoreIdsChange,
  stores,
  onReset 
}) {
  const presets = [
    { label: 'Today', value: 'today', days: 0 },
    { label: 'Last 7 Days', value: '7days', days: 7 },
    { label: 'Last 30 Days', value: '30days', days: 30 },
  ];

  const handlePreset = (days) => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = days === 0 ? new Date() : subDays(new Date(), days);
    start.setHours(0, 0, 0, 0);
    onDateRangeChange({ from: start, to: end });
  };

  const handleStoreToggle = (storeId) => {
    const newSelection = selectedStoreIds.includes(storeId)
      ? selectedStoreIds.filter(id => id !== storeId)
      : [...selectedStoreIds, storeId];
    onStoreIdsChange(newSelection);
  };

  const hasFilters = dateRange.from || selectedStoreIds.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Date Range Presets */}
      <div className="flex gap-2">
        {presets.map(preset => (
          <Button
            key={preset.value}
            variant="outline"
            size="sm"
            onClick={() => handlePreset(preset.days)}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      {/* Custom Date Range Picker */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Calendar className="w-4 h-4" />
            {dateRange.from ? (
              dateRange.to ? (
                <>
                  {format(dateRange.from, 'MMM d, yyyy')} - {format(dateRange.to, 'MMM d, yyyy')}
                </>
              ) : (
                format(dateRange.from, 'MMM d, yyyy')
              )
            ) : (
              'All Dates'
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <CalendarComponent
            mode="range"
            selected={dateRange}
            onSelect={onDateRangeChange}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>

      {/* Store Filter */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Store className="w-4 h-4" />
            {selectedStoreIds.length === 0 ? 'All Stores' : `${selectedStoreIds.length} Store(s)`}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64">
          <div className="space-y-2">
            <div className="font-medium text-sm mb-2">Filter by Store</div>
            <div className="space-y-1">
              {stores.map(store => (
                <div
                  key={store.id}
                  className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded cursor-pointer"
                  onClick={() => handleStoreToggle(store.id)}
                >
                  <input
                    type="checkbox"
                    checked={selectedStoreIds.includes(store.id)}
                    onChange={() => {}}
                    className="rounded"
                  />
                  <div className="flex items-center gap-2 flex-1">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: store.color || '#6366f1' }}
                    />
                    <span className="text-sm">{store.name}</span>
                  </div>
                </div>
              ))}
            </div>
            {selectedStoreIds.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onStoreIdsChange([])}
                className="w-full"
              >
                Clear Selection
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Active Filters */}
      {hasFilters && (
        <div className="flex items-center gap-2 ml-2">
          <span className="text-xs text-slate-500">Active filters:</span>
          {dateRange.from && (
            <Badge variant="secondary" className="gap-1">
              Date Range
              <X
                className="w-3 h-3 cursor-pointer"
                onClick={() => onDateRangeChange({ from: null, to: null })}
              />
            </Badge>
          )}
          {selectedStoreIds.length > 0 && (
            <Badge variant="secondary" className="gap-1">
              {selectedStoreIds.length} Store(s)
              <X
                className="w-3 h-3 cursor-pointer"
                onClick={() => onStoreIdsChange([])}
              />
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-6 px-2 text-xs"
          >
            <X className="w-3 h-3 mr-1" />
            Clear All
          </Button>
        </div>
      )}
    </div>
  );
}