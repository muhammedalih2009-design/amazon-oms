import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Upload, Loader, AlertCircle, CheckCircle2, Download } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function SettlementUpload({ onSuccess }) {
  const { tenant, tenantId } = useTenant();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState(null);
  const [importResult, setImportResult] = useState(null);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setImportResult(null);
  };

  const downloadErrorCSV = () => {
    if (!importResult?.parseErrors) return;

    const headers = ['Row', 'Column', 'Reason'];
    const rows = importResult.parseErrors.map(e => [
      e.row,
      e.column,
      e.reason
    ]);

    const csv = [headers, ...rows].map(r => r.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `settlement_import_errors_${new Date().toISOString().substring(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    // Pre-validation on frontend
    if (!tenantId) {
      toast({ title: 'No workspace selected', description: 'Please select a workspace first', variant: 'destructive' });
      return;
    }

    if (!file) {
      toast({ title: 'Select a CSV file', description: 'Please choose a CSV file to import', variant: 'destructive' });
      return;
    }

    console.log(`[Settlement Upload] Preparing import. WorkspaceID: ${tenantId}, File: ${file.name}, Size: ${file.size} bytes`);

    setLoading(true);
    setImportResult(null);

    try {
      // Convert file to base64
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Content = reader.result.split(',')[1]; // Remove data:text/csv;base64, prefix

          const response = await base44.functions.invoke('importSettlementCSV', {
            file_name: file.name,
            file_content: base64Content,
            workspace_id: tenantId
          });
          const data = response.data;

          if (data.success) {
            setImportResult({
              success: true,
              rowsCount: data.rowsCount,
              matchedCount: data.matchedCount,
              unmatchedCount: data.unmatchedCount,
              parseErrors: data.parseErrors || [],
              totalParseErrors: data.totalParseErrors || 0
            });

            const msg = data.totalParseErrors > 0
              ? `${data.rowsCount} rows imported (${data.matchedCount} matched, ${data.totalParseErrors} parse warnings)`
              : `${data.rowsCount} rows imported (${data.matchedCount} matched)`;

            toast({
              title: 'Import successful',
              description: msg
            });

            setFile(null);
            setTimeout(() => onSuccess(), 1000);
          }
        } catch (error) {
          const errorData = error.response?.data || {};

          setImportResult({
            success: false,
            code: errorData.code || 'UNKNOWN_ERROR',
            message: errorData.message || error.message,
            details: errorData.details || [],
            sampleExpectedHeaders: errorData.sampleExpectedHeaders || []
          });

          toast({
            title: 'Import failed',
            description: errorData.message || error.message,
            variant: 'destructive'
          });
        } finally {
          setLoading(false);
        }
      };

      reader.readAsDataURL(file);
    } catch (error) {
      toast({
        title: 'Error reading file',
        description: error.message,
        variant: 'destructive'
      });
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6 space-y-4">
      <div>
        <h3 className="font-semibold text-slate-900 mb-2">Upload Settlement CSV</h3>
        <p className="text-sm text-slate-500">Select Amazon Settlement Custom Transaction report</p>
      </div>

      <div className="flex gap-3">
        <input
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          disabled={loading}
          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg"
        />
        <Button
          onClick={handleImport}
          disabled={!file || loading}
          className="bg-indigo-600 hover:bg-indigo-700"
        >
          {loading ? (
            <>
              <Loader className="w-4 h-4 mr-2 animate-spin" />
              Importing...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4 mr-2" />
              Import
            </>
          )}
        </Button>
      </div>

      {/* Success Result */}
      {importResult?.success && (
        <Alert className="border-emerald-200 bg-emerald-50">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertDescription className="text-emerald-800 ml-2">
            <div className="font-semibold">{importResult.rowsCount} rows imported</div>
            <div className="text-sm">
              {importResult.matchedCount} matched, {importResult.unmatchedCount} unmatched
              {importResult.totalParseErrors > 0 && `, ${importResult.totalParseErrors} parse warnings`}
            </div>
            {importResult.parseErrors?.length > 0 && (
              <div className="mt-2">
                <div className="text-xs font-medium mb-1">Parse Issues (first {importResult.parseErrors.length}):</div>
                <div className="text-xs space-y-1 max-h-48 overflow-y-auto bg-white rounded p-2">
                  {importResult.parseErrors.map((err, idx) => (
                    <div key={idx} className="text-slate-600">
                      Row {err.row}, {err.column}: {err.reason}
                    </div>
                  ))}
                </div>
                <Button
                  onClick={downloadErrorCSV}
                  size="sm"
                  variant="outline"
                  className="mt-2"
                >
                  <Download className="w-3 h-3 mr-1" />
                  Download Error Details
                </Button>
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Error Result */}
      {importResult && !importResult.success && (
        <Alert className="border-red-200 bg-red-50">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800 ml-2">
            <div className="font-semibold">{importResult.code}: {importResult.message}</div>
            {importResult.sampleExpectedHeaders?.length > 0 && (
              <div className="text-xs mt-2">
                <div className="font-medium">Expected columns:</div>
                <div className="text-slate-700">{importResult.sampleExpectedHeaders.join(', ')}</div>
              </div>
            )}
            {importResult.details?.length > 0 && (
              <div className="text-xs mt-2">
                <div className="font-medium mb-1">Issues (first {importResult.details.length}):</div>
                <div className="bg-white rounded p-2 max-h-32 overflow-y-auto space-y-1">
                  {importResult.details.map((detail, idx) => (
                    <div key={idx} className="text-slate-600">
                      Row {detail.row}, {detail.column}: {detail.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}