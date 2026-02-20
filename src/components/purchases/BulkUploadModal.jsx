import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { Upload, FileText, AlertTriangle, CheckCircle, XCircle, Download, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/ui/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function BulkUploadModal({ open, onClose, tenantId, onSuccess }) {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState([]);
  const [validationResult, setValidationResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [pollInterval, setPollInterval] = useState(null);

  const normalizeHeader = (header) => {
    const normalized = header.toLowerCase().replace(/[\s_]+/g, '');
    const headerMap = {
      'skucode': 'sku_code',
      'unitprice': 'unit_price',
      'suppliername': 'supplier_name',
      'quantity': 'quantity',
      'purchasedate': 'purchase_date'
    };
    return headerMap[normalized] || normalized;
  };

  const parseCSV = (text) => {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];

    const rawHeaders = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const headers = rawHeaders.map(h => normalizeHeader(h));
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const values = [];
      let current = '';
      let inQuotes = false;

      for (let j = 0; j < lines[i].length; j++) {
        const char = lines[i][j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim().replace(/^"|"$/g, ''));
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim().replace(/^"|"$/g, ''));

      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      rows.push(row);
    }

    return rows;
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.type === 'text/csv') {
      setFile(selectedFile);
      setValidationResult(null);
    } else {
      toast({
        title: 'Invalid file type',
        description: 'Please select a CSV file',
        variant: 'destructive'
      });
    }
  };

  const handleValidate = async () => {
    if (!file) {
      toast({ title: 'No file selected', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const text = await file.text();
      const textUtf8 = text.replace(/^\uFEFF/, '');
      const parsedRows = parseCSV(textUtf8);

      if (parsedRows.length === 0) {
        toast({ title: 'Empty CSV file', variant: 'destructive' });
        setLoading(false);
        return;
      }

      setRows(parsedRows);

      // Call validation function
      const { data } = await base44.functions.invoke('validatePurchasesImport', {
        tenant_id: tenantId,
        rows: parsedRows
      });

      setValidationResult(data);
      setStep(2);
    } catch (error) {
      console.error('Validation error:', error);
      toast({
        title: 'Validation failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleStartImport = async () => {
    if (!validationResult || validationResult.valid_count === 0) {
      toast({ title: 'No valid rows to import', variant: 'destructive' });
      return;
    }

    setLoading(true);
    setStep(3);

    try {
      // Filter only valid rows
      const validRows = [];
      const invalidSet = new Set(validationResult.errors?.map(e => e.row) || []);

      rows.forEach((row, idx) => {
        if (!invalidSet.has(idx + 1)) {
          validRows.push(row);
        }
      });

      // Start import job
      const { data } = await base44.functions.invoke('startPurchasesImport', {
        tenant_id: tenantId,
        rows: validRows,
        filename: file.name
      });

      if (!data.ok) {
        throw new Error(data.error || 'Failed to start import');
      }

      setJobId(data.job_id);
      setJobStatus({ status: 'queued', processed_count: 0, total_count: validRows.length, success_count: 0, failed_count: 0, progress_percent: 0 });

      // Start polling job status every 2 seconds
      const interval = setInterval(() => pollJobStatus(data.job_id), 2000);
      setPollInterval(interval);
    } catch (error) {
      console.error('Import start error:', error);
      toast({
        title: 'Import failed',
        description: error.message,
        variant: 'destructive'
      });
      setStep(2);
    } finally {
      setLoading(false);
    }
  };

  const pollJobStatus = async (id) => {
    try {
      const job = await base44.asServiceRole.entities.BackgroundJob.get(id);
      if (!job) return;

      setJobStatus({
        status: job.status,
        processed_count: job.processed_count || 0,
        total_count: job.total_count || 0,
        success_count: job.success_count || 0,
        failed_count: job.failed_count || 0,
        progress_percent: job.progress_percent || 0,
        error_message: job.error_message || null
      });

      if (job.status === 'completed' || job.status === 'failed') {
        if (pollInterval) clearInterval(pollInterval);
        setStep(4);
      }
    } catch (error) {
      console.error('Poll error:', error);
    }
  };

  const handleClose = () => {
    if (pollInterval) clearInterval(pollInterval);
    setStep(1);
    setFile(null);
    setRows([]);
    setValidationResult(null);
    setJobId(null);
    setJobStatus(null);
    onClose();
    if (jobStatus?.status === 'completed') {
      onSuccess?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk Upload Purchases</DialogTitle>
        </DialogHeader>

        <Tabs value={`step${step}`} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="step1" disabled={step < 1}>Upload</TabsTrigger>
            <TabsTrigger value="step2" disabled={step < 2}>Validate</TabsTrigger>
            <TabsTrigger value="step3" disabled={step < 3}>Import</TabsTrigger>
            <TabsTrigger value="step4" disabled={step < 4}>Complete</TabsTrigger>
          </TabsList>

          {/* Step 1: Upload */}
          <TabsContent value="step1" className="space-y-4">
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <Upload className="w-8 h-8 mx-auto mb-3 text-slate-400" />
              <p className="font-medium mb-2">Select CSV file</p>
              <p className="text-sm text-slate-500 mb-4">Required columns: sku_code, quantity</p>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
                id="csv-input"
              />
              <label htmlFor="csv-input" className="cursor-pointer">
                <Button variant="outline" asChild>
                  <span>Browse Files</span>
                </Button>
              </label>
              {file && (
                <p className="mt-4 text-sm text-green-600">
                  ✓ {file.name}
                </p>
              )}
            </div>

            <Button onClick={handleValidate} disabled={!file || loading} className="w-full">
              {loading ? <Loader className="w-4 h-4 mr-2 animate-spin" /> : null}
              Validate
            </Button>
          </TabsContent>

          {/* Step 2: Validation Results */}
          <TabsContent value="step2" className="space-y-4">
            {validationResult && (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <p className="text-sm text-slate-600">Total Rows</p>
                    <p className="text-2xl font-bold text-blue-600">{validationResult.total}</p>
                  </div>
                  <div className="bg-green-50 p-4 rounded-lg">
                    <p className="text-sm text-slate-600">Valid</p>
                    <p className="text-2xl font-bold text-green-600">{validationResult.valid_count}</p>
                  </div>
                  <div className="bg-red-50 p-4 rounded-lg">
                    <p className="text-sm text-slate-600">Invalid</p>
                    <p className="text-2xl font-bold text-red-600">{validationResult.invalid_count}</p>
                  </div>
                </div>

                {validationResult.errors.length > 0 && (
                  <Alert variant="destructive">
                    <AlertTriangle className="w-4 h-4" />
                    <AlertDescription>
                      <p className="font-medium mb-2">Errors found (showing first 10):</p>
                      <ul className="space-y-1 text-sm">
                        {validationResult.errors.slice(0, 10).map((err, i) => (
                          <li key={i}>
                            Row {err.row} ({err.sku_code}): {err.issues}
                          </li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
                  <Button
                    onClick={handleStartImport}
                    disabled={validationResult.valid_count === 0 || loading}
                    className="flex-1"
                  >
                    {loading ? <Loader className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Start Import ({validationResult.valid_count} rows)
                  </Button>
                </div>
              </>
            )}
          </TabsContent>

          {/* Step 3: Progress */}
          <TabsContent value="step3" className="space-y-4">
            {jobStatus && (
              <>
                {jobStatus.status === 'failed' && (
                  <Alert variant="destructive">
                    <AlertTriangle className="w-4 h-4" />
                    <AlertDescription>
                      <p className="font-medium">Import failed</p>
                      <p className="text-sm">{jobStatus.error_message || 'Unknown error'}</p>
                    </AlertDescription>
                  </Alert>
                )}
                
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Progress</span>
                    <span className="font-medium">
                      {jobStatus.processed_count} / {jobStatus.total_count}
                    </span>
                  </div>
                  <Progress value={jobStatus.progress_percent || 0} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-green-50 p-4 rounded-lg">
                    <p className="text-sm text-slate-600">Success</p>
                    <p className="text-2xl font-bold text-green-600">{jobStatus.success_count}</p>
                  </div>
                  <div className="bg-red-50 p-4 rounded-lg">
                    <p className="text-sm text-slate-600">Failed</p>
                    <p className="text-2xl font-bold text-red-600">{jobStatus.failed_count}</p>
                  </div>
                </div>

                {jobStatus.status === 'running' && (
                  <div className="flex items-center justify-center py-4">
                    <Loader className="w-5 h-5 animate-spin text-indigo-600 mr-2" />
                    <span className="text-sm text-slate-600">Processing...</span>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* Step 4: Complete */}
          <TabsContent value="step4" className="space-y-4">
            {jobStatus && (
              <>
                {jobStatus.status === 'completed' && (
                  <div className="flex flex-col items-center justify-center py-8">
                    <CheckCircle className="w-12 h-12 text-green-600 mb-4" />
                    <p className="text-lg font-medium mb-2">Import Completed</p>
                    <p className="text-sm text-slate-600 text-center">
                      Successfully imported {jobStatus.success_count} purchases
                      {jobStatus.failed_count > 0 && ` with ${jobStatus.failed_count} failures`}
                    </p>
                  </div>
                )}
                {jobStatus.status === 'failed' && (
                  <div className="flex flex-col items-center justify-center py-8">
                    <XCircle className="w-12 h-12 text-red-600 mb-4" />
                    <p className="text-lg font-medium mb-2">Import Failed</p>
                    <p className="text-sm text-slate-600 text-center">
                      {jobStatus.error_message || 'An error occurred during import'}
                    </p>
                  </div>
                )}
                <Button onClick={handleClose} className="w-full">
                  Close
                </Button>
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}