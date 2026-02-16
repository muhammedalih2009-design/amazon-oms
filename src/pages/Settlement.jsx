import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format, parseISO } from 'date-fns';
import ErrorBoundary from '@/components/shared/ErrorBoundary';
import SettlementUpload from '@/components/settlement/SettlementUpload';
import SettlementOrdersTab from '@/components/settlement/SettlementOrdersTab';
import SettlementSKUTab from '@/components/settlement/SettlementSKUTab';
import SettlementUnmatchedTab from '@/components/settlement/SettlementUnmatchedTab';
import SettlementImportsTab from '@/components/settlement/SettlementImportsTab';
import SettlementFilters from '@/components/settlement/SettlementFilters';
import { DollarSign, TrendingUp, AlertCircle, Loader2, Info, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useCallback } from 'react';

export default function Settlement() {
  const { tenantId } = useTenant();
  const [activeTab, setActiveTab] = useState('orders');
  const [imports, setImports] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedImportId, setSelectedImportId] = useState(null);
  const [integrityStatus, setIntegrityStatus] = useState(null);
  const [autoHealing, setAutoHealing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // URL-persisted filters
  const [dateRange, setDateRange] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const from = params.get('from');
    const to = params.get('to');
    return {
      from: from ? parseISO(from) : null,
      to: to ? parseISO(to) : null
    };
  });
  const [selectedStoreIds, setSelectedStoreIds] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const stores = params.get('stores');
    return stores ? stores.split(',') : [];
  });

  // Load stores
  const { data: stores = [] } = useQuery({
    queryKey: ['stores', tenantId],
    queryFn: () => base44.entities.Store.filter({ tenant_id: tenantId }),
    enabled: !!tenantId
  });

  // Update URL when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (dateRange.from) params.set('from', format(dateRange.from, 'yyyy-MM-dd'));
    if (dateRange.to) params.set('to', format(dateRange.to, 'yyyy-MM-dd'));
    if (selectedStoreIds.length > 0) params.set('stores', selectedStoreIds.join(','));
    
    const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
    window.history.replaceState({}, '', newUrl);
  }, [dateRange, selectedStoreIds]);

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

  // Filter rows based on date and store
  const filteredRows = useMemo(() => {
    let filtered = rows.filter(r => !r.is_deleted);

    // Date filter
    if (dateRange.from || dateRange.to) {
      filtered = filtered.filter(row => {
        if (!row.datetime) return false;
        const rowDate = new Date(row.datetime);
        if (dateRange.from && rowDate < dateRange.from) return false;
        if (dateRange.to && rowDate > dateRange.to) return false;
        return true;
      });
    }

    // Store filter (match by marketplace field)
    if (selectedStoreIds.length > 0) {
      const storeNames = stores
        .filter(s => selectedStoreIds.includes(s.id))
        .map(s => s.name.toLowerCase());
      
      filtered = filtered.filter(row => {
        if (!row.marketplace) return false;
        return storeNames.some(name => row.marketplace.toLowerCase().includes(name));
      });
    }

    return filtered;
  }, [rows, dateRange, selectedStoreIds, stores]);

  const latestImport = selectedImportId 
    ? imports.find(i => i.id === selectedImportId)
    : imports[0];

  // Calculate KPIs from filtered rows (real-time calculation as fallback)
  const calculatedTotals = useMemo(() => {
    const activeRows = filteredRows;
    
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
  }, [filteredRows]);

  // Use cached totals if available, otherwise use calculated
  const totals = latestImport?.totals_cached_json && latestImport.totals_cached_json.total_revenue !== undefined
    ? { ...latestImport.totals_cached_json, source: 'cached' }
    : calculatedTotals;

  // Log warning if KPIs are zero but rows exist
  useEffect(() => {
    if (filteredRows.length > 0 && totals.total_revenue === 0) {
      console.warn('[Settlement] WARNING: KPIs are zero but rows exist', {
        rows_count: rows.length,
        filtered_rows: filteredRows.length,
        totals,
        import_id: selectedImportId
      });
    }
  }, [filteredRows, totals, selectedImportId]);

  const handleResetFilters = () => {
    setDateRange({ from: null, to: null });
    setSelectedStoreIds([]);
  };

  // Master refresh function - refreshes ALL settlement data
  const refreshAll = useCallback(async () => {
    if (isRefreshing) return;
    
    console.log('[Settlement] Master refresh started');
    setIsRefreshing(true);
    
    try {
      // Step 1: Refresh imports
      console.log('[Settlement] fetchImports fired');
      await loadImports();
      
      // Step 2: Refresh settlement rows
      console.log('[Settlement] fetchSettlementRows fired');
      if (selectedImportId) {
        await loadRows(true);
      }
      
      // Step 3: Trigger refetch in child components by incrementing key
      console.log('[Settlement] fetchOrdersTable fired');
      console.log('[Settlement] fetchSkuProfitability fired');
      console.log('[Settlement] fetchUnmatched fired');
      setRefreshKey(prev => prev + 1);
      
      setLastRefreshAt(new Date());
      console.log('[Settlement] Master refresh completed');
    } catch (error) {
      console.error('[Settlement] Master refresh failed:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [selectedImportId, isRefreshing]);

  const runOrderCostDiagnostic = async () => {
    try {
      const response = await base44.functions.invoke('diagnosticOrderCost', {
        workspace_id: tenantId
      });
      console.log('[DIAGNOSTIC] Order Cost Analysis:', response.data);
      alert('Check browser console for diagnostic results');
    } catch (error) {
      console.error('[DIAGNOSTIC] Error:', error);
      alert('Diagnostic failed: ' + error.message);
    }
  };

  return (
    <ErrorBoundary fallbackTitle="Settlement page failed to load">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Settlement & Profitability</h1>
            <p className="text-slate-500">Track Amazon settlement transactions and order profitability</p>
          </div>
          
          <div className="flex items-center gap-3">
            {lastRefreshAt && (
              <span className="text-xs text-slate-500">
                Last refreshed: {format(lastRefreshAt, 'HH:mm:ss')}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={runOrderCostDiagnostic}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              🔧 Diagnose Cost
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAll}
              disabled={isRefreshing}
              className="gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
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

        {/* Filters */}
        <SettlementFilters
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          selectedStoreIds={selectedStoreIds}
          onStoreIdsChange={setSelectedStoreIds}
          stores={stores}
          onReset={handleResetFilters}
        />

        {/* Summary Cards */}
        {latestImport && (
          <div className="space-y-2">
            {/* Data source indicator */}
            {totals.source && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Info className="w-3 h-3" />
                <span>
                  {totals.source === 'cached' ? 'Using cached totals' : `Calculated from ${totals.rows_count || 0} filtered rows`}
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
              key={`orders-${refreshKey}`}
              rows={filteredRows} 
              tenantId={tenantId}
              onDataChange={() => {
                loadRows();
                loadImports();
              }}
              hideRefreshButton={true}
            />
          </TabsContent>

          <TabsContent value="skus" className="space-y-4">
            <SettlementSKUTab 
              key={`skus-${refreshKey}`}
              rows={filteredRows} 
              tenantId={tenantId} 
            />
          </TabsContent>

          <TabsContent value="unmatched" className="space-y-4">
            <SettlementUnmatchedTab 
              key={`unmatched-${refreshKey}`}
              rows={filteredRows} 
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