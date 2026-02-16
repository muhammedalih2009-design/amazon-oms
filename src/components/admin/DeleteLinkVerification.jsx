import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Play, CheckCircle, XCircle } from 'lucide-react';

export default function DeleteLinkVerification() {
  const { tenantId } = useTenant();
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  const runVerification = async () => {
    if (!tenantId) {
      toast({
        title: 'No Workspace',
        description: 'Please select a workspace first',
        variant: 'destructive'
      });
      return;
    }

    setTesting(true);
    setResult(null);

    try {
      // Step 1: Get 3 sample settlement rows
      const allRows = await base44.entities.SettlementRow.filter({
        tenant_id: tenantId,
        is_deleted: false
      });

      if (allRows.length < 3) {
        toast({
          title: 'Insufficient Data',
          description: 'Need at least 3 settlement rows for testing',
          variant: 'destructive'
        });
        setTesting(false);
        return;
      }

      const testRows = allRows.slice(0, 3);
      const testOrderIds = testRows.map(r => r.order_id);

      console.log('[DeleteLinkVerification] Step 1: Selected order IDs:', testOrderIds);

      // Step 2: Delete orders
      const deleteResponse = await base44.functions.invoke('deleteSettlementOrders', {
        workspace_id: tenantId,
        order_ids: testOrderIds
      });

      console.log('[DeleteLinkVerification] Step 2: Delete response:', deleteResponse.data);

      // Step 3: Verify affected rows
      const verificationResult = {
        step1_selected_order_ids: testOrderIds,
        step2_delete_response: {
          input_order_ids: deleteResponse.data.diagnostics?.input_order_ids || testOrderIds,
          normalized_order_ids: deleteResponse.data.diagnostics?.normalized_order_ids || [],
          matched_order_ids: deleteResponse.data.matched_order_ids || [],
          unmatched_order_ids: deleteResponse.data.unmatched_order_ids || [],
          affected_settlement_rows: deleteResponse.data.affected_settlement_rows,
          message: deleteResponse.data.message
        },
        step3_verification: null
      };

      // Step 4: Verify UI reflects changes
      const rowsAfterDelete = await base44.entities.SettlementRow.filter({
        tenant_id: tenantId,
        order_id: { $in: testOrderIds }
      });

      const deletedRows = rowsAfterDelete.filter(r => r.is_deleted);
      const activeRows = rowsAfterDelete.filter(r => !r.is_deleted);

      verificationResult.step3_verification = {
        total_rows_for_test_orders: rowsAfterDelete.length,
        deleted_rows: deletedRows.length,
        active_rows: activeRows.length,
        ui_reflects_changes: deletedRows.length > 0
      };

      // Step 5: Restore for future tests
      await base44.functions.invoke('restoreSettlementOrders', {
        workspace_id: tenantId,
        order_ids: testOrderIds
      });

      setResult(verificationResult);

      const success = verificationResult.step2_delete_response.affected_settlement_rows > 0;
      toast({
        title: success ? 'Verification Passed' : 'Verification Failed',
        description: success 
          ? `Affected ${verificationResult.step2_delete_response.affected_settlement_rows} rows` 
          : 'No rows affected',
        variant: success ? 'default' : 'destructive'
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

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Delete-Link Verification</h3>
          <p className="text-sm text-slate-500">Test order deletion affects settlement rows correctly</p>
        </div>
        <Button
          onClick={runVerification}
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
              Run Test
            </>
          )}
        </Button>
      </div>

      {result && (
        <div className="space-y-4 mt-6">
          {/* Step 1: Selected IDs */}
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
            <h4 className="font-semibold text-blue-900 mb-2">Step 1: Selected Order IDs</h4>
            <div className="space-y-1">
              {result.step1_selected_order_ids.map((id, idx) => (
                <p key={idx} className="text-sm font-mono text-blue-700">{id}</p>
              ))}
            </div>
          </div>

          {/* Step 2: Delete Response */}
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <h4 className="font-semibold text-slate-900 mb-3">Step 2: Delete Response</h4>
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-medium text-slate-700">Normalized IDs:</span>
                <div className="mt-1 space-y-1">
                  {result.step2_delete_response.normalized_order_ids.map((id, idx) => (
                    <p key={idx} className="font-mono text-slate-600">{id}</p>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div>
                  <span className="font-medium text-slate-700">Matched IDs:</span>
                  <p className="text-lg font-bold text-emerald-600">
                    {result.step2_delete_response.matched_order_ids.length}
                  </p>
                </div>
                <div>
                  <span className="font-medium text-slate-700">Unmatched IDs:</span>
                  <p className="text-lg font-bold text-red-600">
                    {result.step2_delete_response.unmatched_order_ids.length}
                  </p>
                </div>
              </div>
              <div className="pt-2">
                <span className="font-medium text-slate-700">Settlement Rows Affected:</span>
                <p className="text-2xl font-bold text-slate-900">
                  {result.step2_delete_response.affected_settlement_rows}
                </p>
              </div>
              <div className="pt-2">
                <Badge variant={result.step2_delete_response.affected_settlement_rows > 0 ? 'default' : 'destructive'}>
                  {result.step2_delete_response.message}
                </Badge>
              </div>
            </div>
          </div>

          {/* Step 3: UI Verification */}
          <div className={`rounded-lg p-4 border ${
            result.step3_verification.ui_reflects_changes 
              ? 'bg-emerald-50 border-emerald-200' 
              : 'bg-red-50 border-red-200'
          }`}>
            <div className="flex items-center gap-2 mb-2">
              {result.step3_verification.ui_reflects_changes ? (
                <CheckCircle className="w-5 h-5 text-emerald-600" />
              ) : (
                <XCircle className="w-5 h-5 text-red-600" />
              )}
              <h4 className={`font-semibold ${
                result.step3_verification.ui_reflects_changes ? 'text-emerald-900' : 'text-red-900'
              }`}>
                Step 3: UI Verification
              </h4>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="font-medium">Total Rows:</span>
                <p className="text-lg font-bold">{result.step3_verification.total_rows_for_test_orders}</p>
              </div>
              <div>
                <span className="font-medium">Deleted:</span>
                <p className="text-lg font-bold text-red-600">{result.step3_verification.deleted_rows}</p>
              </div>
              <div>
                <span className="font-medium">Active:</span>
                <p className="text-lg font-bold text-emerald-600">{result.step3_verification.active_rows}</p>
              </div>
            </div>
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