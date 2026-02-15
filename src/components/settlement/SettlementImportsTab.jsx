import React, { useState } from 'react';
import { format } from 'date-fns';
import SettlementUpload from './SettlementUpload';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertCircle, Clock } from 'lucide-react';

export default function SettlementImportsTab({
  imports,
  selectedImportId,
  onImportSelect,
  onImportSuccess,
  tenantId
}) {
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
      <SettlementUpload tenantId={tenantId} onSuccess={onImportSuccess} />

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
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}