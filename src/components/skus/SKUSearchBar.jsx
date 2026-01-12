import React from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

export default function SKUSearchBar({ value, onChange, placeholder = "Search by SKU code or product name..." }) {
  return (
    <div className="relative mb-6">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
      <Input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-12 h-12 text-base bg-white border-slate-200 rounded-xl"
      />
    </div>
  );
}