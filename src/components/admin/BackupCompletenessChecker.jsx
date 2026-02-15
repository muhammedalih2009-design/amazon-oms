import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

export default function BackupCompletenessChecker({ tenantId }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [liveData, setLiveData] = useState(null);
  const [backupData, setBackupData] = useState(null);
  const [comparison, setComparison] = useState(null);

  const checkLiveRecords = async () => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke('verifyBackupCompleteness', { tenantId });
      setLiveData(response.data.liveRecordCounts);
      toast({ title: 'Live counts fetched' });
    } catch (error) {
      toast({ title: 'Error fetching live counts', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const loadLatestBackup = async () => {
    setLoading(true);
    try {
      const backups = await base44.entities.BackupJob.filter({ 
        tenant_id: tenantId,
        status: 'completed'
      });
      
      if (backups.length === 0) {
        toast({ title: 'No completed backups found', variant: 'destructive' });
        return;
      }

      const latest = backups[0];
      setBackupData(latest.stats);

      // Compare
      if (liveData) {
        const comparisonResult = Object.keys(liveData).map(entity => ({
          entity,
          live: liveData[entity] || 0,
          backup: latest.stats?.[entity] || 0,
          match: (liveData[entity] || 0) === (latest.stats?.[entity] || 0)
        }));
        setComparison(comparisonResult);
      }

      toast({ title: 'Latest backup stats loaded' });
    } catch (error) {
      toast({ title: 'Error loading backup', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
      <h3 className="font-bold text-lg">Backup Completeness Checker</h3>
      
      <div className="flex gap-2">
        <Button onClick={checkLiveRecords} disabled={loading} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Check Live Records
        </Button>
        <Button onClick={loadLatestBackup} disabled={loading || !liveData} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Load Latest Backup Stats
        </Button>
      </div>

      {liveData && (
        <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
          <h4 className="font-semibold text-blue-900 mb-2">Live Record Counts</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
            {Object.entries(liveData).map(([entity, count]) => (
              <div key={entity} className="text-blue-800">
                {entity}: <span className="font-bold">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {comparison && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-slate-100">
              <tr>
                <th className="border border-slate-300 p-2 text-left">Entity</th>
                <th className="border border-slate-300 p-2 text-center">Live</th>
                <th className="border border-slate-300 p-2 text-center">Backup</th>
                <th className="border border-slate-300 p-2 text-center">Match</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map(row => (
                <tr key={row.entity} className={row.match ? 'bg-emerald-50' : 'bg-red-50'}>
                  <td className="border border-slate-300 p-2 font-medium">{row.entity}</td>
                  <td className="border border-slate-300 p-2 text-center">{row.live}</td>
                  <td className="border border-slate-300 p-2 text-center">{row.backup}</td>
                  <td className="border border-slate-300 p-2 text-center">
                    {row.match ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 mx-auto" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-red-600 mx-auto" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 p-3 bg-slate-50 rounded text-sm">
            <strong>Summary:</strong> {comparison.filter(r => r.match).length}/{comparison.length} entities match
          </div>
        </div>
      )}
    </div>
  );
}