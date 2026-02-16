import React, { useState } from 'react';
import { format } from 'date-fns';
import SettlementUpload from './SettlementUpload';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertCircle, Clock, RefreshCw, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';

export default function SettlementImportsTab({
  imports,
  selectedImportId,
  onImportSelect,
  onImportSuccess,
  tenantId
}) {
  const { toast } = useToast();
  const [rebuilding, setRebuilding] = useState(null);

  const handleRebuildRows = async (importId) => {
    setRebuilding(importId);
    try {
      const response = await base44.functions.invoke('rebuildSettlementRows', {
        workspace_id: tenantId,
        import_id: importId
      });

      toast({
        title: 'Rows Rebuilt',
        description: `Created ${response.data.rows_created} rows, ${response.data.rows_matched} matched`
      });

      if (onImportSuccess) onImportSuccess();
    } catch (error) {
      toast({
        title: 'Rebuild Failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setRebuilding(null);
    }
  };
  const getStatusIcon = (status) => {
    if (status === 'completed') return <CheckCircle2 className="w-5 h-5 text-emerald-600" />;
    if (status === 'completed_with_errors') return <AlertCircle className="w-5 h-5 text-amber-600" />;
    if (status === 'failed') return <AlertCircle className="w-5 h-5 text-red-600" />;
    return <Clock className="w-5 h-5 text-slate-400" />;
  };

  const getStatusBadge = (status, parseErrors) => {
    if (status === 'completed' && parseErrors === 0) return 'Success';
    if (status === 'completed_with_errors' || parseErrors > 0) return 'Completed with errors';
    if (status === 'failed') return 'Failed';
    return 'Processing';
  };

  return (
    <div className="space-y-6">
      <SettlementUpload onSuccess={onImportSuccess} />

      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h3 className="font-semibold text-slate-900 mb-4">Recent Imports</h3>
        {imports.length === 0 ? (
          <p className="text-slate-500 text-center py-8">No imports yet</p>
        ) : (
          <div className="space-y-3">
            {imports.map(imp => (
              <div
                key={imp.id}
                onClick={() => onImportSelect(imp.id)}
                className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                  selectedImportId === imp.id
                    ? 'bg-indigo-50 border-indigo-300'
                    : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    {getStatusIcon(imp.status)}
                    <div>
                      <p className="font-medium text-slate-900">{imp.file_name}</p>
                      <p className="text-sm text-slate-500">
                        {format(new Date(imp.created_date), 'MMM d, yyyy h:mm a')} • Month: {imp.month_key}
                      </p>
                      {imp.error_message && (
                        <p className="text-xs text-red-600 mt-1">Error: {imp.error_message}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-medium">{imp.rows_count} rows</p>
                      <p className="text-xs text-slate-500">
                        {imp.matched_rows_count} matched, {imp.unmatched_rows_count} unmatched
                      </p>
                      <p className={`text-xs font-medium mt-1 ${
                        imp.total_parse_errors > 0 ? 'text-amber-600' : 'text-emerald-600'
                      }`}>
                        {getStatusBadge(imp.status, imp.total_parse_errors)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRebuildRows(imp.id);
                      }}
                      disabled={rebuilding === imp.id}
                      title="Rebuild settlement rows in database"
                    >
                      {rebuilding === imp.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}