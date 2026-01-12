import React from 'react';
import { Badge } from '@/components/ui/badge';

const statusStyles = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  fulfilled: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  partially_returned: 'bg-blue-50 text-blue-700 border-blue-200',
  fully_returned: 'bg-slate-50 text-slate-700 border-slate-200',
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  inactive: 'bg-slate-50 text-slate-700 border-slate-200',
  past_due: 'bg-red-50 text-red-700 border-red-200',
  canceled: 'bg-red-50 text-red-700 border-red-200',
  trial: 'bg-violet-50 text-violet-700 border-violet-200',
  pro: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  free: 'bg-slate-50 text-slate-700 border-slate-200',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  processing: 'bg-blue-50 text-blue-700 border-blue-200',
};

const statusLabels = {
  pending: 'Pending',
  fulfilled: 'Fulfilled',
  partially_returned: 'Partially Returned',
  fully_returned: 'Fully Returned',
  active: 'Active',
  inactive: 'Inactive',
  past_due: 'Past Due',
  canceled: 'Canceled',
  trial: 'Trial',
  pro: 'Pro',
  free: 'Free',
  success: 'Success',
  partial: 'Partial',
  failed: 'Failed',
  processing: 'Processing',
};

export default function StatusBadge({ status, className = '' }) {
  const style = statusStyles[status] || statusStyles.pending;
  const label = statusLabels[status] || status;

  return (
    <Badge variant="outline" className={`${style} font-medium capitalize ${className}`}>
      {label}
    </Badge>
  );
}