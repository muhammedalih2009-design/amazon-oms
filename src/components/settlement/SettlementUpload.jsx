import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Upload, Loader } from 'lucide-react';

export default function SettlementUpload({ tenantId, onSuccess }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState(null);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleImport = async () => {
    if (!file) {
      toast({ title: 'Select a CSV file first', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('csvFile', file);
      formData.append('tenantId', tenantId);

      const response = await base44.functions.invoke('importSettlementCSV', formData);

      toast({
        title: 'Import successful',
        description: `${response.data.rowsCount} rows imported (${response.data.matchedCount} matched)`
      });

      setFile(null);
      onSuccess();
    } catch (error) {
      toast({
        title: 'Import failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
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
    </div>
  );
}