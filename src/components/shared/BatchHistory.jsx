import React, { useState } from 'react';
import { format } from 'date-fns';
import { Download, Trash2, FileText, CheckCircle, AlertCircle, XCircle, Pencil, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import StatusBadge from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';

export default function BatchHistory({ 
  batches = [], 
  onDelete,
  onDownloadErrors,
  onBatchUpdated,
  showDelete = true,
  loading = false
}) {
  const [editingBatchId, setEditingBatchId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [savingBatchId, setSavingBatchId] = useState(null);
  const { toast } = useToast();

  const handleStartEdit = (batch) => {
    setEditingBatchId(batch.id);
    setEditValue(batch.display_name || batch.batch_name || '');
  };

  const handleCancelEdit = () => {
    setEditingBatchId(null);
    setEditValue('');
  };

  const handleSaveEdit = async (batch) => {
    const trimmedValue = editValue.trim();
    
    // Validate length
    if (trimmedValue.length > 80) {
      toast({ 
        title: 'Name too long', 
        description: 'Display name must be 80 characters or less',
        variant: 'destructive' 
      });
      return;
    }

    setSavingBatchId(batch.id);
    
    try {
      // Update batch with new display_name
      const updatedBatch = await base44.entities.ImportBatch.update(batch.id, {
        display_name: trimmedValue || null
      });

      // Verify response contains display_name
      if (!updatedBatch || updatedBatch.display_name === undefined) {
        console.warn('API response missing display_name field:', updatedBatch);
        toast({ 
          title: 'Warning',
          description: 'Rename saved but not returned by server – refreshing data',
          variant: 'destructive'
        });
      }

      // Notify parent to refresh
      if (onBatchUpdated) {
        onBatchUpdated();
      }

      toast({ 
        title: 'Batch renamed successfully',
        description: trimmedValue ? `Renamed to: ${trimmedValue}` : 'Reverted to default name'
      });

      setEditingBatchId(null);
      setEditValue('');
    } catch (error) {
      console.error('Failed to rename batch:', error);
      toast({ 
        title: 'Failed to rename batch', 
        description: error.message,
        variant: 'destructive' 
      });
    } finally {
      setSavingBatchId(null);
    }
  };

  const handleKeyDown = (e, batch) => {
    if (e.key === 'Enter') {
      handleSaveEdit(batch);
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };
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
            <div className="flex items-center gap-4 flex-1">
              {getStatusIcon(batch.status)}
              <div className="flex-1 min-w-0">
                {editingBatchId === batch.id ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, batch)}
                      placeholder="Enter batch name"
                      className="h-8 text-sm"
                      autoFocus
                      disabled={savingBatchId === batch.id}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                      onClick={() => handleSaveEdit(batch)}
                      disabled={savingBatchId === batch.id}
                    >
                      {savingBatchId === batch.id ? (
                        <div className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-slate-600 hover:text-slate-700"
                      onClick={handleCancelEdit}
                      disabled={savingBatchId === batch.id}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 group">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900 truncate">
                        {batch.display_name || batch.batch_name || batch.filename || 'Import Batch'}
                      </p>
                      <p className="text-sm text-slate-500">
                        {format(new Date(batch.created_date), 'MMM d, yyyy h:mm a')}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleStartEdit(batch)}
                    >
                      <Pencil className="w-4 h-4 text-slate-500" />
                    </Button>
                  </div>
                )}
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
                    onClick={() => {
                      if (batch.error_file_url) {
                        const link = document.createElement('a');
                        link.href = batch.error_file_url;
                        link.download = `errors_${batch.batch_name || 'import'}_${new Date().toISOString().split('T')[0]}.csv`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      }
                      onDownloadErrors?.(batch);
                    }}
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