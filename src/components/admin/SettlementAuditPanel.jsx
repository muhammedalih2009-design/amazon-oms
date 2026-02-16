import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Play, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

export default function SettlementAuditPanel() {
  const { tenantId } = useTenant();
  const { toast } = useToast();
  const [auditing, setAuditing] = useState(false);
  const [result, setResult] = useState(null);

  const runAudit = async () => {
    if (!tenantId) {
      toast({
        title: 'No Workspace',
        description: 'Please select a workspace first',
        variant: 'destructive'
      });
      return;
    }

    setAuditing(true);
    setResult(null);

    try {
      const response = await base44.functions.invoke('auditSettlementIntegrity', {
        workspace_id: tenantId
      });

      console.log('[SettlementAuditPanel] Audit result:', response.data);
      setResult(response.data);

      const isHealthy = response.data.status === 'HEALTHY';
      toast({
        title: isHealthy ? 'Settlement Healthy' : 'Issues Found',
        description: isHealthy 
          ? 'All settlement data is consistent' 
          : `Found ${response.data.issues?.length || 0} issues`,
        variant: isHealthy ? 'default' : 'destructive'
      });
    } catch (error) {
      toast({
        title: 'Audit Failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setAuditing(false);
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'CRITICAL': return 'text-red-600 bg-red-50 border-red-200';
      case 'HIGH': return 'text-orange-600 bg-orange-50 border-orange-200';
      case 'MEDIUM': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      default: return 'text-slate-600 bg-slate-50 border-slate-200';
    }
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Settlement Integrity Audit</h3>
          <p className="text-sm text-slate-500">Validate data pipeline and KPI calculations</p>
        </div>
        <Button
          onClick={runAudit}
          disabled={auditing}
          className="bg-indigo-600 hover:bg-indigo-700"
        >
          {auditing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Auditing...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2" />
              Run Audit
            </>
          )}
        </Button>
      </div>

      {result && (
        <div className="space-y-4 mt-6">
          {/* Status Header */}
          <div className={`rounded-lg p-4 border ${
            result.status === 'HEALTHY' 
              ? 'bg-emerald-50 border-emerald-200' 
              : result.status === 'NO_DATA'
              ? 'bg-slate-50 border-slate-200'
              : 'bg-red-50 border-red-200'
          }`}>
            <div className="flex items-center gap-2">
              {result.status === 'HEALTHY' ? (
                <CheckCircle className="w-5 h-5 text-emerald-600" />
              ) : result.status === 'NO_DATA' ? (
                <AlertTriangle className="w-5 h-5 text-slate-600" />
              ) : (
                <XCircle className="w-5 h-5 text-red-600" />
              )}
              <h4 className={`font-semibold ${
                result.status === 'HEALTHY' ? 'text-emerald-900' : 
                result.status === 'NO_DATA' ? 'text-slate-900' : 'text-red-900'
              }`}>
                Status: {result.status}
              </h4>
            </div>
            {result.message && (
              <p className="text-sm mt-1 text-slate-700">{result.message}</p>
            )}
          </div>

          {/* Summary */}
          {result.summary && (
            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
              <h4 className="font-semibold text-slate-900 mb-3">Data Summary</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-slate-600">Total Imports:</span>
                  <p className="text-lg font-bold">{result.summary.total_imports}</p>
                </div>
                <div>
                  <span className="text-slate-600">Active Rows:</span>
                  <p className="text-lg font-bold">{result.summary.active_rows}</p>
                </div>
                <div>
                  <span className="text-slate-600">Expected Rows:</span>
                  <p className="text-lg font-bold">{result.summary.expected_rows}</p>
                </div>
                <div>
                  <span className="text-slate-600">Matched Orders:</span>
                  <p className="text-lg font-bold">{result.summary.matched_orders}</p>
                </div>
              </div>
            </div>
          )}

          {/* KPIs Comparison */}
          {result.kpis && (
            <div className="bg-white rounded-lg p-4 border border-slate-200">
              <h4 className="font-semibold text-slate-900 mb-3">KPI Validation</h4>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="font-medium text-slate-700">Metric</div>
                  <div className="font-medium text-slate-700">Cached</div>
                  <div className="font-medium text-slate-700">Calculated</div>
                </div>
                
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="text-slate-600">Revenue</div>
                  <div>${result.kpis.cached.total_revenue?.toFixed(2) || '0.00'}</div>
                  <div>${result.kpis.calculated.total_revenue?.toFixed(2) || '0.00'}</div>
                </div>

                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="text-slate-600">COGS</div>
                  <div>${result.kpis.cached.total_cogs?.toFixed(2) || '0.00'}</div>
                  <div>${result.kpis.calculated.total_cogs?.toFixed(2) || '0.00'}</div>
                </div>

                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="text-slate-600">Profit</div>
                  <div>${result.kpis.cached.total_profit?.toFixed(2) || '0.00'}</div>
                  <div>${result.kpis.calculated.total_profit?.toFixed(2) || '0.00'}</div>
                </div>

                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="text-slate-600">Margin</div>
                  <div>{((result.kpis.cached.margin || 0) * 100).toFixed(1)}%</div>
                  <div>{((result.kpis.calculated.margin || 0) * 100).toFixed(1)}%</div>
                </div>

                {result.kpis.mismatch && (
                  <Badge variant="destructive" className="mt-2">KPI Mismatch Detected</Badge>
                )}
              </div>
            </div>
          )}

          {/* Issues */}
          {result.issues && result.issues.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-semibold text-slate-900">Issues Found</h4>
              {result.issues.map((issue, idx) => (
                <div key={idx} className={`rounded-lg p-4 border ${getSeverityColor(issue.severity)}`}>
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold">{issue.type}</span>
                        <Badge variant="outline">{issue.severity}</Badge>
                      </div>
                      <p className="text-sm">{issue.message}</p>
                      {issue.expected !== undefined && (
                        <p className="text-xs mt-1">Expected: {issue.expected}, Actual: {issue.actual}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Recommendations */}
          {result.recommendations && result.recommendations.length > 0 && (
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
              <h4 className="font-semibold text-blue-900 mb-2">Recommendations</h4>
              <ul className="space-y-1 text-sm text-blue-800">
                {result.recommendations.map((rec, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-blue-600">•</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Raw JSON */}
          <details className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <summary className="cursor-pointer font-medium text-slate-700 text-sm">
              View Full Report JSON
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