import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { useToast } from '@/components/ui/use-toast';
import { CheckCircle, XCircle, AlertCircle, Loader2, Play } from 'lucide-react';

export default function SettlementIntegrityPanel() {
  const { tenantId } = useTenant();
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  const handleVerifyIntegrity = async () => {
    if (!tenantId) {
      toast({
        title: 'No Workspace',
        description: 'Please select a workspace first',
        variant: 'destructive'
      });
      return;
    }

    // Get recent import for testing
    const imports = await base44.entities.SettlementImport.filter({
      tenant_id: tenantId,
      status: { $in: ['completed', 'completed_with_errors'] }
    });

    if (imports.length === 0) {
      toast({
        title: 'No Imports Found',
        description: 'Please import settlement data first',
        variant: 'destructive'
      });
      return;
    }

    const importId = imports[0].id;

    setTesting(true);
    setResult(null);

    try {
      const { data } = await base44.functions.invoke('verifySettlementIntegrity', {
        workspace_id: tenantId,
        import_id: importId
      });

      setResult(data);

      const passed = data.summary.tests_passed;
      const failed = data.summary.tests_failed;

      toast({
        title: failed === 0 ? 'All Tests Passed' : 'Some Tests Failed',
        description: `${passed} passed, ${failed} failed`,
        variant: failed === 0 ? 'default' : 'destructive'
      });
    } catch (error) {
      toast({
        title: 'Verification Failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setTesting(false);
    }
  };

  const getStatusIcon = (status) => {
    if (status === 'PASS') return <CheckCircle className="w-4 h-4 text-emerald-600" />;
    if (status === 'FAIL') return <XCircle className="w-4 h-4 text-red-600" />;
    if (status === 'SKIP') return <AlertCircle className="w-4 h-4 text-amber-600" />;
    return <AlertCircle className="w-4 h-4 text-blue-600" />;
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Settlement Integrity Verification</h3>
          <p className="text-sm text-slate-500">Run comprehensive integrity tests on settlement pipeline</p>
        </div>
        <Button
          onClick={handleVerifyIntegrity}
          disabled={testing}
          className="bg-indigo-600 hover:bg-indigo-700"
        >
          {testing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Testing...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2" />
              Run Verification
            </>
          )}
        </Button>
      </div>

      {result && (
        <div className="space-y-4 mt-6">
          {/* Summary */}
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <h4 className="font-semibold text-slate-900 mb-3">Summary</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-slate-500">Parsed Rows</p>
                <p className="text-lg font-bold text-slate-900">{result.summary.parsed_rows}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Settlement Rows (Before)</p>
                <p className="text-lg font-bold text-slate-900">{result.summary.settlement_rows_before}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Settlement Rows (After)</p>
                <p className="text-lg font-bold text-slate-900">{result.summary.settlement_rows_after}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Integrity Status</p>
                <Badge variant={result.summary.integrity_status === 'OK' ? 'default' : 'destructive'}>
                  {result.summary.integrity_status}
                </Badge>
              </div>
            </div>
            <div className="mt-3 flex gap-3">
              <Badge variant="outline" className="text-emerald-600 border-emerald-300">
                {result.summary.tests_passed} Passed
              </Badge>
              {result.summary.tests_failed > 0 && (
                <Badge variant="outline" className="text-red-600 border-red-300">
                  {result.summary.tests_failed} Failed
                </Badge>
              )}
              {result.summary.tests_skipped > 0 && (
                <Badge variant="outline" className="text-amber-600 border-amber-300">
                  {result.summary.tests_skipped} Skipped
                </Badge>
              )}
              {result.summary.duplicates_detected && (
                <Badge variant="destructive">Duplicates Detected</Badge>
              )}
            </div>
          </div>

          {/* Test Results Table */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left py-2 px-4 text-xs font-semibold text-slate-600">Test</th>
                  <th className="text-left py-2 px-4 text-xs font-semibold text-slate-600">Details</th>
                  <th className="text-center py-2 px-4 text-xs font-semibold text-slate-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.tests.map((test, idx) => (
                  <tr key={idx} className="border-b border-slate-100 last:border-0">
                    <td className="py-3 px-4">
                      <p className="font-medium text-slate-900 text-sm">{test.test}</p>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-xs text-slate-600 space-y-1">
                        {Object.entries(test)
                          .filter(([key]) => !['test', 'status'].includes(key))
                          .map(([key, value]) => (
                            <div key={key}>
                              <span className="font-medium">{key.replace(/_/g, ' ')}:</span> {JSON.stringify(value)}
                            </div>
                          ))}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {getStatusIcon(test.status)}
                        <span className="text-sm font-medium">{test.status}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Raw JSON */}
          <details className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <summary className="cursor-pointer font-medium text-slate-700 text-sm">
              View Raw JSON
            </summary>
            <pre className="mt-3 text-xs overflow-x-auto bg-white p-3 rounded border border-slate-200">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </Card>
  );
}