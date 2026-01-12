import React from 'react';
import { format } from 'date-fns';
import { Download, Trash2, FileText, CheckCircle, AlertCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';

export default function BatchHistory({ 
  batches = [], 
  onDelete,
  onDownloadErrors,
  showDelete = true,
  loading = false
}) {
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Import History</h3>
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-slate-100 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (batches.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Import History</h3>
        <EmptyState
          icon={FileText}
          title="No imports yet"
          description="Your import history will appear here"
        />
      </div>
    );
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-emerald-600" />;
      case 'partial':
        return <AlertCircle className="w-5 h-5 text-amber-600" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-600" />;
      default:
        return <FileText className="w-5 h-5 text-slate-400" />;
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6">
      <h3 className="text-lg font-semibold text-slate-900 mb-4">Import History</h3>
      
      <div className="space-y-3">
        {batches.map((batch) => (
          <div 
            key={batch.id} 
            className="flex items-center justify-between p-4 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <div className="flex items-center gap-4">
              {getStatusIcon(batch.status)}
              <div>
                <p className="font-medium text-slate-900">
                  {batch.batch_name || batch.filename || 'Import Batch'}
                </p>
                <p className="text-sm text-slate-500">
                  {format(new Date(batch.created_date), 'MMM d, yyyy h:mm a')}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-medium text-slate-900">
                  {batch.success_rows || 0}/{batch.total_rows || 0} rows
                </p>
                <StatusBadge status={batch.status} />
              </div>
              
              <div className="flex items-center gap-2">
                {batch.error_file_url && batch.failed_rows > 0 && (
                  <Button 
                    variant="ghost" 
                    size="icon"
                    onClick={() => onDownloadErrors?.(batch)}
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                )}
                {showDelete && (
                  <Button 
                    variant="ghost" 
                    size="icon"
                    onClick={() => onDelete?.(batch)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}