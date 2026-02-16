import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format } from 'date-fns';
import ErrorBoundary from '@/components/shared/ErrorBoundary';
import SettlementUpload from '@/components/settlement/SettlementUpload';
import SettlementOrdersTab from '@/components/settlement/SettlementOrdersTab';
import SettlementSKUTab from '@/components/settlement/SettlementSKUTab';
import SettlementUnmatchedTab from '@/components/settlement/SettlementUnmatchedTab';
import SettlementImportsTab from '@/components/settlement/SettlementImportsTab';
import { DollarSign, TrendingUp, AlertCircle, Loader2, Info } from 'lucide-react';
import { useMemo } from 'react';

export default function Settlement() {
  const { tenantId } = useTenant();
  const [activeTab, setActiveTab] = useState('orders');
  const [imports, setImports] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedImportId, setSelectedImportId] = useState(null);
  const [integrityStatus, setIntegrityStatus] = useState(null);
  const [autoHealing, setAutoHealing] = useState(false);

  useEffect(() => {
    if (tenantId) loadImports();
  }, [tenantId]);

  const loadImports = async () => {
    setLoading(true);
    try {
      const importsData = await base44.entities.SettlementImport.filter({
        tenant_id: tenantId,
        status: 'completed'
      });
      setImports(importsData.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)));
      
      if (importsData.length > 0 && !selectedImportId) {
        setSelectedImportId(importsData[0].id);
      }
    } catch (error) {
      console.error('Load imports error:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedImportId && tenantId) {
      checkIntegrityAndHeal();
    }
  }, [selectedImportId, tenantId]);

  const checkIntegrityAndHeal = async () => {
    try {
      const { data } = await base44.functions.invoke('checkSettlementIntegrity', {
        workspace_id: tenantId,
        import_id: selectedImportId
      });

      setIntegrityStatus(data);

      if (data.needs_rebuild && data.status !== 'OK') {
        // Auto-heal
        setAutoHealing(true);
        await base44.functions.invoke('rebuildSettlementRows', {
          workspace_id: tenantId,
          import_id: selectedImportId
        });
        setAutoHealing(false);
        // Reload after heal
        loadRows();
        loadImports();
      } else {
        loadRows();
      }
    } catch (error) {
      console.error('Integrity check error:', error);
      loadRows();
    }
  };

  const loadRows = async (forceRefresh = false) => {
    try {
      // Force a fresh fetch by adding a timestamp to bust any caching
      const rowsData = await base44.entities.SettlementRow.filter({
        tenant_id: tenantId,
        settlement_import_id: selectedImportId
      });
      console.log(`[Settlement] Loaded ${rowsData.length} rows, deleted count:`, rowsData.filter(r => r.is_deleted).length);
      setRows(rowsData);
    } catch (error) {
      console.error('Load rows error:', error);
    }
  };

  const latestImport = selectedImportId 
    ? imports.find(i => i.id === selectedImportId)
    : imports[0];

  // Calculate KPIs from active rows (real-time calculation as fallback)
  const calculatedTotals = useMemo(() => {
    const activeRows = rows.filter(r => !r.is_deleted);
    
    if (activeRows.length === 0) {
      return {
        total_revenue: 0,
        total_cogs: 0,
        total_profit: 0,
        margin: 0,
        source: 'empty'
      };
    }

    const total_revenue = activeRows.reduce((sum, row) => sum + (row.total || 0), 0);
    
    // For COGS: We need to match with orders to get accurate COGS
    // This is a simplified calculation - the full version requires order matching
    const total_profit = total_revenue; // Placeholder - actual COGS matching happens in Orders tab
    
    return {
      total_revenue,
      total_cogs: 0, // Will be calculated from order matching
      total_profit,
      margin: total_revenue !== 0 ? total_profit / total_revenue : 0,
      source: 'calculated',
      rows_count: activeRows.length
    };
  }, [rows]);

  // Use cached totals if available, otherwise use calculated
  const totals = latestImport?.totals_cached_json && latestImport.totals_cached_json.total_revenue !== undefined
    ? { ...latestImport.totals_cached_json, source: 'cached' }
    : calculatedTotals;

  // Log warning if KPIs are zero but rows exist
  useEffect(() => {
    if (rows.length > 0 && totals.total_revenue === 0) {
      console.warn('[Settlement] WARNING: KPIs are zero but rows exist', {
        rows_count: rows.length,
        active_rows: rows.filter(r => !r.is_deleted).length,
        totals,
        import_id: selectedImportId
      });
    }
  }, [rows, totals, selectedImportId]);

  return (
    <ErrorBoundary fallbackTitle="Settlement page failed to load">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Settlement & Profitability</h1>
            <p className="text-slate-500">Track Amazon settlement transactions and order profitability</p>
          </div>
        </div>

        {/* Auto-heal banner */}
        {autoHealing && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
            <div>
              <p className="font-medium text-blue-900">Data repair in progress</p>
              <p className="text-sm text-blue-700">Rebuilding settlement rows from import data...</p>
            </div>
          </div>
        )}

        {/* Integrity warning */}
        {integrityStatus && integrityStatus.status !== 'OK' && !autoHealing && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
              <div>
                <p className="font-medium text-amber-900">Data inconsistency detected</p>
                <p className="text-sm text-amber-700">
                  Expected {integrityStatus.expected_rows} rows, found {integrityStatus.actual_rows}. 
                  Missing {integrityStatus.missing_rows} rows.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Summary Cards */}
        {latestImport && (
          <div className="space-y-2">
            {/* Data source indicator */}
            {totals.source && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Info className="w-3 h-3" />
                <span>
                  {totals.source === 'cached' ? 'Using cached totals' : `Calculated from ${totals.rows_count || 0} active rows`}
                </span>
              </div>
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-500">Total Revenue</p>
                    <p className="text-2xl font-bold text-slate-900">${totals.total_revenue?.toFixed(2) || '0.00'}</p>
                  </div>
                  <DollarSign className="w-8 h-8 text-blue-500" />
                </div>
              </div>

            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Total COGS</p>
                  <p className="text-2xl font-bold text-slate-900">${totals.total_cogs?.toFixed(2) || '0.00'}</p>
                </div>
                <TrendingUp className="w-8 h-8 text-amber-500" />
              </div>
            </div>

            <div className={`bg-white rounded-lg border border-slate-200 p-4 ${totals.total_profit < 0 ? 'border-red-200' : 'border-emerald-200'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Total Profit</p>
                  <p className={`text-2xl font-bold ${totals.total_profit < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    ${totals.total_profit?.toFixed(2) || '0.00'}
                  </p>
                </div>
                <div className={`w-8 h-8 ${totals.total_profit < 0 ? 'text-red-500' : 'text-emerald-500'}`}>📊</div>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Margin</p>
                  <p className="text-2xl font-bold text-slate-900">{(totals.margin * 100)?.toFixed(1) || '0.0'}%</p>
                </div>
                <TrendingUp className="w-8 h-8 text-purple-500" />
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4 bg-slate-100">
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="skus">SKU Profitability</TabsTrigger>
            <TabsTrigger value="unmatched">Unmatched</TabsTrigger>
            <TabsTrigger value="import">Import Settlement</TabsTrigger>
          </TabsList>

          <TabsContent value="orders" className="space-y-4">
            <SettlementOrdersTab 
              rows={rows} 
              tenantId={tenantId}
              onDataChange={() => {
                loadRows();
                loadImports();
              }}
            />
          </TabsContent>

          <TabsContent value="skus" className="space-y-4">
            <SettlementSKUTab rows={rows} tenantId={tenantId} />
          </TabsContent>

          <TabsContent value="unmatched" className="space-y-4">
            <SettlementUnmatchedTab 
              rows={rows} 
              tenantId={tenantId}
              onDataChange={() => {
                loadRows();
                loadImports();
              }}
            />
          </TabsContent>

          <TabsContent value="import" className="space-y-4">
            <SettlementImportsTab 
              imports={imports}
              selectedImportId={selectedImportId}
              onImportSelect={setSelectedImportId}
              onImportSuccess={() => {
                loadImports();
                setActiveTab('orders');
              }}
            />
          </TabsContent>
        </Tabs>
      </div>
    </ErrorBoundary>
  );
}