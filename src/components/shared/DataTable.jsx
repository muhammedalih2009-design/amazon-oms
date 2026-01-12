import React from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { TableSkeleton } from '@/components/ui/LoadingSkeleton';
import EmptyState from '@/components/ui/EmptyState';

export default function DataTable({
  columns = [],
  data = [],
  loading = false,
  emptyIcon,
  emptyTitle = 'No data',
  emptyDescription = 'No records found',
  emptyAction,
  onEmptyAction,
  sortColumn,
  sortDirection,
  onSort,
  stickyHeader = true,
  className = ''
}) {
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-6">
        <TableSkeleton rows={5} cols={columns.length || 4} />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100">
        <EmptyState
          icon={emptyIcon}
          title={emptyTitle}
          description={emptyDescription}
          actionLabel={emptyAction}
          onAction={onEmptyAction}
        />
      </div>
    );
  }

  const handleSort = (column) => {
    if (!column.sortable || !onSort) return;
    onSort(column.key);
  };

  const getSortIcon = (column) => {
    if (!column.sortable) return null;
    if (sortColumn !== column.key) {
      return <ChevronsUpDown className="w-4 h-4 text-slate-300" />;
    }
    return sortDirection === 'asc' 
      ? <ChevronUp className="w-4 h-4 text-indigo-600" />
      : <ChevronDown className="w-4 h-4 text-indigo-600" />;
  };

  return (
    <div className={`bg-white rounded-2xl border border-slate-100 overflow-hidden ${className}`}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className={stickyHeader ? 'sticky top-0 z-10' : ''}>
            <tr className="bg-slate-50 border-b border-slate-100">
              {columns.map((column) => (
                <th
                  key={column.key}
                  onClick={() => handleSort(column)}
                  className={`
                    py-4 px-6 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider
                    ${column.sortable ? 'cursor-pointer hover:text-slate-700 select-none' : ''}
                    ${column.align === 'right' ? 'text-right' : ''}
                    ${column.align === 'center' ? 'text-center' : ''}
                  `}
                  style={{ width: column.width }}
                >
                  <div className={`flex items-center gap-1 ${column.align === 'right' ? 'justify-end' : ''}`}>
                    {column.header}
                    {getSortIcon(column)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {data.map((row, rowIndex) => (
              <tr 
                key={row.id || rowIndex} 
                className="hover:bg-slate-50/50 transition-colors"
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`
                      py-4 px-6 text-sm
                      ${column.align === 'right' ? 'text-right' : ''}
                      ${column.align === 'center' ? 'text-center' : ''}
                    `}
                  >
                    {column.render ? column.render(row[column.key], row) : row[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}