import React from 'react';
import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function RefreshButton({ onRefresh, loading = false, className = '' }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onRefresh}
      disabled={loading}
      className={className}
    >
      <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
      <span className="hidden sm:inline ml-2">Refresh</span>
    </Button>
  );
}