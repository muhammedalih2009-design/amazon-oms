import React, { useState, useRef } from 'react';
import { Upload, FileText, Download, X, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

export default function CSVUploader({ 
  onUpload, 
  templateUrl, 
  templateName = 'template.csv',
  title = 'Upload CSV',
  description = 'Upload a CSV file to import data',
  acceptedTypes = '.csv',
  processing = false,
  result = null,
  onReset
}) {
  const [file, setFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = () => {
    if (file && onUpload) {
      onUpload(file);
    }
  };

  const handleReset = () => {
    setFile(null);
    if (onReset) onReset();
  };

  const downloadTemplate = () => {
    const link = document.createElement('a');
    link.href = templateUrl;
    link.download = templateName;
    link.click();
  };

  if (result) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-6">
        <div className="text-center">
          {result.status === 'success' ? (
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-emerald-600" />
            </div>
          ) : result.status === 'partial' ? (
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-amber-600" />
            </div>
          ) : (
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <X className="w-8 h-8 text-red-600" />
            </div>
          )}
          
          <h3 className="text-lg font-semibold text-slate-900 mb-2">
            {result.status === 'success' ? 'Import Successful' : 
             result.status === 'partial' ? 'Partial Import' : 'Import Failed'}
          </h3>
          
          <div className="grid grid-cols-3 gap-4 my-6">
            <div className="bg-slate-50 rounded-xl p-4">
              <p className="text-2xl font-bold text-slate-900">{result.total_rows || 0}</p>
              <p className="text-sm text-slate-500">Total Rows</p>
            </div>
            <div className="bg-emerald-50 rounded-xl p-4">
              <p className="text-2xl font-bold text-emerald-600">{result.success_rows || 0}</p>
              <p className="text-sm text-slate-500">Successful</p>
            </div>
            <div className="bg-red-50 rounded-xl p-4">
              <p className="text-2xl font-bold text-red-600">{result.failed_rows || 0}</p>
              <p className="text-sm text-slate-500">Failed</p>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3">
            {result.error_file_url && result.failed_rows > 0 && (
              <Button 
                variant="outline" 
                onClick={() => {
                  const link = document.createElement('a');
                  link.href = result.error_file_url;
                  link.download = `import_errors_${new Date().toISOString().split('T')[0]}.csv`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
              >
                <Download className="w-4 h-4 mr-2" />
                Download Errors
              </Button>
            )}
            <Button onClick={handleReset}>
              Upload Another File
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <p className="text-sm text-slate-500">{description}</p>
        </div>
        {templateUrl && (
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="w-4 h-4 mr-2" />
            Template
          </Button>
        )}
      </div>

      <div
        className={`
          relative border-2 border-dashed rounded-xl p-8 text-center transition-all
          ${dragActive ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}
          ${file ? 'bg-slate-50' : ''}
        `}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept={acceptedTypes}
          onChange={handleChange}
          className="hidden"
        />

        {file ? (
          <div className="space-y-4">
            <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mx-auto">
              <FileText className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <p className="font-medium text-slate-900">{file.name}</p>
              <p className="text-sm text-slate-500">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" onClick={() => setFile(null)}>
                <X className="w-4 h-4 mr-2" />
                Remove
              </Button>
              <Button 
                onClick={handleUpload} 
                disabled={processing}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {processing ? (
                  <>
                    <span className="animate-spin mr-2">⏳</span>
                    Processing...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div 
            className="space-y-4 cursor-pointer" 
            onClick={() => inputRef.current?.click()}
          >
            <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto">
              <Upload className="w-6 h-6 text-slate-400" />
            </div>
            <div>
              <p className="font-medium text-slate-700">
                Drag & drop your file here, or <span className="text-indigo-600">browse</span>
              </p>
              <p className="text-sm text-slate-500 mt-1">CSV files only</p>
            </div>
          </div>
        )}
      </div>

      {processing && (
        <div className="mt-4">
          <Progress value={50} className="h-2" />
          <p className="text-sm text-slate-500 mt-2 text-center">Processing your file...</p>
        </div>
      )}
    </div>
  );
}