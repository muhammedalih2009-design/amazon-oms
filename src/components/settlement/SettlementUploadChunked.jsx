import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Upload, Loader, AlertCircle, CheckCircle2, Download, Play } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';

export default function SettlementUploadChunked({ onSuccess }) {
  const { tenantId } = useTenant();
  const { toast } = useToast();
  const [file, setFile] = useState(null);
  const [state, setState] = useState('idle'); // idle, parsing, processing, complete, error
  const [importId, setImportId] = useState(null);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [result, setResult] = useState(null);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setResult(null);
  };

  const handleStart = async () => {
    if (!tenantId || !file) {
      toast({ title: 'Missing file or workspace', variant: 'destructive' });
      return;
    }

    setState('parsing');
    setStatusMsg('Parsing CSV...');

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Content = reader.result.split(',')[1];

          const response = await base44.functions.invoke('importSettlementStartPhaseA', {
            file_name: file.name,
            file_content: base64Content,
            workspace_id: tenantId
          });

          if (response.data.ok) {
            setImportId(response.data.import_id);
            setProgress(0);
            setState('processing');
            setStatusMsg(`Starting chunk processing (${response.data.total_rows} rows)...`);
            setFile(null);

            // Start processing chunks
            processChunks(response.data.import_id, response.data.total_rows);
          }
        } catch (error) {
          setState('error');
          setResult({
            success: false,
            message: error.response?.data?.message || error.message
          });
          toast({
            title: 'Parse failed',
            description: error.response?.data?.message || error.message,
            variant: 'destructive'
          });
        }
      };
      reader.readAsDataURL(file);
    } catch (error) {
      setState('error');
      setResult({ success: false, message: error.message });
      toast({ title: 'File read error', description: error.message, variant: 'destructive' });
    }
  };

  const processChunks = async (id, totalRows) => {
    while (true) {
      try {
        const response = await base44.functions.invoke('importSettlementProcessChunk', {
          import_id: id
        });

        const data = response.data;

        if (data.ok) {
          const pct = data.total_rows > 0 ? Math.round((data.processed_rows / data.total_rows) * 100) : 0;
          setProgress(pct);
          setStatusMsg(`Processing: ${data.processed_rows} / ${data.total_rows} rows`);

          if (data.status === 'completed' || data.status === 'completed_with_errors') {
            setState('complete');
            setResult({
              success: true,
              rowsCount: data.processed_rows,
              message: data.status === 'completed' 
                ? 'Import completed successfully'
                : 'Import completed with parse errors'
            });
            toast({
              title: 'Import successful',
              description: `${data.processed_rows} rows imported`
            });
            setTimeout(() => onSuccess(), 1000);
            break;
          }

          if (data.status === 'failed') {
            setState('error');
            setResult({ success: false, message: data.error || 'Import failed' });
            toast({ title: 'Import failed', description: data.error, variant: 'destructive' });
            break;
          }

          // Wait before next chunk
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          throw new Error(data.message || 'Unknown error');
        }
      } catch (error) {
        setState('error');
        setResult({
          success: false,
          message: error.response?.data?.message || error.message
        });
        toast({
          title: 'Chunk processing failed',
          description: error.response?.data?.message || error.message,
          variant: 'destructive'
        });
        break;
      }
    }
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6 space-y-4">
      <div>
        <h3 className="font-semibold text-slate-900 mb-2">Upload Settlement CSV</h3>
        <p className="text-sm text-slate-500">Select Amazon Settlement Custom Transaction report</p>
      </div>

      {state === 'idle' && (
        <div className="flex gap-3">
          <input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            disabled={state !== 'idle'}
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg"
          />
          <Button
            onClick={handleStart}
            disabled={!file}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            <Upload className="w-4 h-4 mr-2" />
            Start
          </Button>
        </div>
      )}

      {(state === 'parsing' || state === 'processing') && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Loader className="w-4 h-4 animate-spin text-indigo-600" />
            <span className="text-sm font-medium">{statusMsg}</span>
          </div>
          <Progress value={progress} className="h-2" />
          <p className="text-xs text-slate-500">{progress}% complete</p>
        </div>
      )}

      {state === 'complete' && result?.success && (
        <Alert className="border-emerald-200 bg-emerald-50">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertDescription className="text-emerald-800 ml-2">
            <div className="font-semibold">{result.rowsCount} rows imported</div>
            <p className="text-sm">{result.message}</p>
          </AlertDescription>
        </Alert>
      )}

      {state === 'error' && result && (
        <Alert className="border-red-200 bg-red-50">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800 ml-2">
            <div className="font-semibold">Import Failed</div>
            <p className="text-sm">{result.message}</p>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}