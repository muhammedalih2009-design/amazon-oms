import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, FileText, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

export default function OptimizedCSVUploader({ 
  title, 
  description, 
  onDataParsed, 
  processing,
  templateUrl,
  templateName 
}) {
  const { toast } = useToast();
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState(null);
  const fileInputRef = useRef(null);
  const workerRef = useRef(null);

  const handleFileChange = async (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.csv')) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload a CSV file',
        variant: 'destructive'
      });
      return;
    }

    setFile(selectedFile);
    setParsing(true);
    setParseResult(null);

    // Use Web Worker for background parsing (non-blocking)
    if (window.Worker) {
      try {
        // Create worker instance
        const worker = new Worker(
          new URL('../workers/csvParser.worker.js', import.meta.url),
          { type: 'module' }
        );
        workerRef.current = worker;

        worker.onmessage = (event) => {
          setParsing(false);
          if (event.data.success) {
            setParseResult({
              success: true,
              rowCount: event.data.rowCount
            });
            // Pass parsed data to parent
            onDataParsed(selectedFile, event.data.data);
          } else {
            setParseResult({
              success: false,
              error: event.data.error
            });
            toast({
              title: 'Parsing failed',
              description: event.data.error,
              variant: 'destructive'
            });
          }
          worker.terminate();
        };

        worker.onerror = (error) => {
          setParsing(false);
          setParseResult({
            success: false,
            error: error.message
          });
          toast({
            title: 'Worker error',
            description: 'Failed to parse CSV in background',
            variant: 'destructive'
          });
          worker.terminate();
        };

        // Send file to worker
        worker.postMessage({ file: selectedFile });
      } catch (error) {
        // Fallback to main thread if worker fails
        console.warn('Web Worker not supported, using main thread');
        await parseInMainThread(selectedFile);
      }
    } else {
      // Fallback for older browsers
      await parseInMainThread(selectedFile);
    }
  };

  const parseInMainThread = async (file) => {
    try {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      const rows = lines.slice(1).length;
      
      setParsing(false);
      setParseResult({
        success: true,
        rowCount: rows
      });
      
      // Basic parsing - parent component will handle detailed parsing
      onDataParsed(file, null);
    } catch (error) {
      setParsing(false);
      setParseResult({
        success: false,
        error: error.message
      });
    }
  };

  const handleReset = () => {
    setFile(null);
    setParseResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (workerRef.current) {
      workerRef.current.terminate();
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-500 mt-1">{description}</p>
      </div>

      {templateUrl && (
        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-slate-400" />
            <span className="text-sm text-slate-700">Download template to get started</span>
          </div>
          <a href={templateUrl} download={templateName}>
            <Button variant="outline" size="sm">
              Download Template
            </Button>
          </a>
        </div>
      )}

      <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-indigo-400 transition-colors">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          className="hidden"
          disabled={processing || parsing}
        />
        
        <Upload className="w-12 h-12 text-slate-400 mx-auto mb-3" />
        
        {!file ? (
          <>
            <p className="text-slate-700 font-medium mb-1">
              Click to upload or drag and drop
            </p>
            <p className="text-sm text-slate-500">CSV file only</p>
            <Button 
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 bg-indigo-600 hover:bg-indigo-700"
              disabled={processing || parsing}
            >
              Select CSV File
            </Button>
          </>
        ) : (
          <>
            {parsing && (
              <div className="flex items-center justify-center gap-2 text-indigo-600">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="font-medium">Parsing in background...</span>
              </div>
            )}
            
            {parseResult && parseResult.success && (
              <div className="flex items-center justify-center gap-2 text-emerald-600">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-medium">
                  Parsed {parseResult.rowCount} rows successfully
                </span>
              </div>
            )}
            
            {parseResult && !parseResult.success && (
              <div className="flex items-center justify-center gap-2 text-red-600">
                <XCircle className="w-5 h-5" />
                <span className="font-medium">Parsing failed</span>
              </div>
            )}
            
            <p className="text-sm text-slate-500 mt-2">{file.name}</p>
            
            <div className="flex items-center justify-center gap-2 mt-4">
              {!processing && (
                <Button 
                  onClick={handleReset}
                  variant="outline"
                >
                  Choose Different File
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      {processing && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
            <div>
              <p className="text-sm font-medium text-blue-900">
                Processing your upload...
              </p>
              <p className="text-xs text-blue-700">
                Large files may take a few moments
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}