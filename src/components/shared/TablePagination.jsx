import React from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function TablePagination({ 
  totalItems, 
  currentPage, 
  pageSize, 
  onPageChange, 
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100]
}) {
  const totalPages = Math.ceil(totalItems / pageSize);
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  const handlePrevious = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNext = () => {
    if (currentPage < totalPages) {
      onPageChange(currentPage + 1);
    }
  };

  const handlePageSizeChange = (value) => {
    const newSize = parseInt(value);
    onPageSizeChange(newSize);
    // Reset to page 1 when changing page size
    onPageChange(1);
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-2 py-4 border-t bg-white">
      {/* Left: Rows per page */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-600">Rows per page:</span>
        <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
          <SelectTrigger className="w-20 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map(size => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Center: Info */}
      <div className="text-sm text-slate-600">
        Showing {startItem.toLocaleString()}-{endItem.toLocaleString()} of {totalItems.toLocaleString()} entries
      </div>

      {/* Right: Navigation */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handlePrevious}
          disabled={currentPage === 1}
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Previous
        </Button>
        <div className="text-sm text-slate-600 px-2">
          Page {currentPage} of {totalPages}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleNext}
          disabled={currentPage === totalPages || totalPages === 0}
        >
          Next
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}