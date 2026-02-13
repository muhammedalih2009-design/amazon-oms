import React from 'react';
import { AlertTriangle, Download, XCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function ImportErrorDisplay({ 
  result, 
  onDownloadErrors 
}) {
  if (!result || result.status === 'success') {
    return null;
  }

  const { 
    primary_error, 
    error_summary = {}, 
    sample_errors = [],
    error_file_url,
    total_rows = 0,
    success_rows = 0,
    failed_rows = 0
  } = result;

  // Calculate error categories
  const errorCategories = Object.entries(error_summary).map(([category, count]) => ({
    category,
    count
  })).sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-4">
      {/* Primary Error Message */}
      <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <XCircle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-semibold text-red-900 mb-1">
              {result.status === 'partial' ? 'Partial Import' : 'Import Failed'}
            </h4>
            <p className="text-sm text-red-800">
              {primary_error || result.error || 'Import encountered errors'}
            </p>
            <div className="flex items-center gap-4 mt-2 text-xs text-red-700">
              <span>Total: {total_rows}</span>
              <span className="text-emerald-700">✓ Success: {success_rows}</span>
              <span className="text-red-700">✗ Failed: {failed_rows}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Error Summary by Category */}
      {errorCategories.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-3 mb-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <h4 className="font-semibold text-amber-900">Errors by Type</h4>
          </div>
          <div className="space-y-2">
            {errorCategories.map(({ category, count }) => (
              <div key={category} className="flex items-center justify-between text-sm">
                <span className="text-amber-800">{category}</span>
                <Badge variant="outline" className="bg-white">
                  {count} {count === 1 ? 'row' : 'rows'}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sample Errors Table */}
      {sample_errors.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
            <h4 className="font-semibold text-slate-900">
              Sample Errors (Top {Math.min(sample_errors.length, 10)})
            </h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left py-2 px-4 text-xs font-semibold text-slate-600">Row</th>
                  <th className="text-left py-2 px-4 text-xs font-semibold text-slate-600">Order ID</th>
                  <th className="text-left py-2 px-4 text-xs font-semibold text-slate-600">SKU Code</th>
                  <th className="text-left py-2 px-4 text-xs font-semibold text-slate-600">Error Reason</th>
                </tr>
              </thead>
              <tbody>
                {sample_errors.slice(0, 10).map((error, idx) => (
                  <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-4 text-sm font-mono text-slate-700">
                      {error.row_number}
                    </td>
                    <td className="py-2 px-4 text-sm text-slate-600">
                      {error.amazon_order_id || '-'}
                    </td>
                    <td className="py-2 px-4 text-sm font-mono text-slate-600">
                      {error.sku_code || '-'}
                    </td>
                    <td className="py-2 px-4 text-sm text-red-700">
                      {error.error_reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Download Failed Rows Button */}
      {error_file_url && failed_rows > 0 && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={onDownloadErrors}
            className="gap-2"
          >
            <Download className="w-4 h-4" />
            Download All Failed Rows ({failed_rows})
          </Button>
        </div>
      )}
    </div>
  );
}