import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, Download, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

export default function BulkUploadModal({ open, onClose, onUpload }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [result, setResult] = useState(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.type === 'text/csv') {
      setFile(selectedFile);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setProgress(10);
    setProgressText('Uploading file...');

    try {
      setProgress(30);
      setProgressText('Processing rows...');
      
      const uploadResult = await onUpload(file);
      
      setProgress(100);
      setProgressText('Complete!');
      
      // Ensure we have a valid result
      if (!uploadResult || uploadResult.status === 'failed') {
        setResult({
          status: 'failed',
          total_rows: uploadResult?.total_rows || 0,
          success_rows: 0,
          failed_rows: uploadResult?.failed_rows || uploadResult?.total_rows || 0,
          error: uploadResult?.error || 'Upload failed',
          error_file_url: uploadResult?.error_file_url
        });
      } else {
        setResult(uploadResult);
      }
      setFile(null);
    } catch (error) {
      setResult({
        status: 'failed',
        total_rows: 0,
        success_rows: 0,
        failed_rows: 0,
        error: error.message || 'Upload failed'
      });
    } finally {
      setUploading(false);
      setProgress(0);
      setProgressText('');
    }
  };

  const handleClose = () => {
    setFile(null);
    setResult(null);
    setProgress(0);
    setProgressText('');
    onClose();
  };

  const downloadErrorCSV = () => {
    if (!result?.error_file_url) return;
    window.open(result.error_file_url, '_blank');
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Bulk Upload SKUs</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Upload Requirements */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-blue-900 mb-2">Required Columns:</h4>
            <div className="text-sm text-blue-700 space-y-1">
              <div>• <strong>sku_code</strong> (required, unique)</div>
              <div>• <strong>product_name</strong> (required)</div>
              <div>• <strong>cost</strong> (required, number &gt; 0)</div>
              <div>• <strong>supplier</strong> (optional, name)</div>
              <div>• <strong>stock</strong> (optional, integer ≥ 0)</div>
              <div>• <strong>image_url</strong> (optional, URL)</div>
            </div>
          </div>

          {/* File Upload Area */}
          {!result && (
            <div>
              <label
                htmlFor="csv-upload"
                className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-indigo-500 hover:bg-slate-50 transition-all"
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-10 h-10 text-slate-400 mb-3" />
                  {file ? (
                    <div className="text-center">
                      <p className="text-sm font-medium text-slate-700">{file.name}</p>
                      <p className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB</p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-sm font-medium text-slate-700">Click to upload CSV</p>
                      <p className="text-xs text-slate-500">or drag and drop</p>
                    </div>
                  )}
                </div>
                <input
                  id="csv-upload"
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>

              {file && (
                <div className="flex gap-3 mt-4">
                  <Button
                    onClick={handleUpload}
                    disabled={uploading}
                    className="flex-1"
                  >
                    {uploading ? 'Uploading...' : 'Validate & Upload'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setFile(null)}
                    disabled={uploading}
                  >
                    Clear
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Progress */}
          {uploading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-600">{progressText}</p>
                <p className="text-xs text-slate-500">{progress}%</p>
              </div>
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-slate-500 italic">
                Processing large files may take a few minutes...
              </p>
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-4">
              {result.status === 'success' && result.success_rows > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                    <h4 className="font-semibold text-green-900">Upload Successful!</h4>
                  </div>
                  <div className="text-sm text-green-700 space-y-1">
                    <p>✓ Total rows found: <strong>{result.total_rows}</strong></p>
                    <p>✓ Successfully imported: <strong>{result.success_rows}</strong></p>
                  </div>
                </div>
              )}

              {result.status === 'partial' && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <AlertCircle className="w-5 h-5 text-orange-600" />
                    <h4 className="font-semibold text-orange-900">Partial Success</h4>
                  </div>
                  <div className="text-sm text-orange-700 space-y-1">
                    <p>• Total rows found: <strong>{result.total_rows}</strong></p>
                    <p>• Successfully imported: <strong>{result.success_rows}</strong></p>
                    <p>• Failed rows: <strong>{result.failed_rows}</strong></p>
                  </div>
                  {result.error_file_url && (
                    <Button
                      onClick={downloadErrorCSV}
                      variant="outline"
                      size="sm"
                      className="mt-3 border-orange-300 text-orange-700 hover:bg-orange-100"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download Error CSV
                    </Button>
                  )}
                </div>
              )}

              {(result.status === 'failed' || result.success_rows === 0) && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <XCircle className="w-5 h-5 text-red-600" />
                    <h4 className="font-semibold text-red-900">Upload Failed</h4>
                  </div>
                  <div className="text-sm text-red-700 space-y-1">
                    {result.error && <p className="mb-2">{result.error}</p>}
                    {result.total_rows > 0 ? (
                      <>
                        <p>• Total rows found: <strong>{result.total_rows}</strong></p>
                        <p>• Successfully imported: <strong>0</strong></p>
                        <p>• Failed rows: <strong>{result.failed_rows || result.total_rows}</strong></p>
                      </>
                    ) : (
                      <p>No valid data rows found in the CSV file.</p>
                    )}
                  </div>
                  {result.error_file_url && (
                    <Button
                      onClick={downloadErrorCSV}
                      variant="outline"
                      size="sm"
                      className="mt-3 border-red-300 text-red-700 hover:bg-red-100"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download Error CSV
                    </Button>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <Button onClick={handleClose} className="flex-1">
                  Done
                </Button>
                <Button variant="outline" onClick={() => setResult(null)}>
                  Upload Another
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}