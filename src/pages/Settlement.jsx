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
import { DollarSign, TrendingUp, AlertCircle } from 'lucide-react';

export default function Settlement() {
  const { tenantId } = useTenant();
  const [activeTab, setActiveTab] = useState('orders');
  const [imports, setImports] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedImportId, setSelectedImportId] = useState(null);

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
      loadRows();
    }
  }, [selectedImportId, tenantId]);

  const loadRows = async () => {
    try {
      const rowsData = await base44.entities.SettlementRow.filter({
        tenant_id: tenantId,
        settlement_import_id: selectedImportId
      });
      setRows(rowsData);
    } catch (error) {
      console.error('Load rows error:', error);
    }
  };

  const latestImport = selectedImportId 
    ? imports.find(i => i.id === selectedImportId)
    : imports[0];

  const totals = latestImport?.totals_cached_json || {
    total_revenue: 0,
    total_cogs: 0,
    total_profit: 0,
    margin: 0
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
        </div>

        {/* Summary Cards */}
        {latestImport && (
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
            <SettlementOrdersTab rows={rows} tenantId={tenantId} />
          </TabsContent>

          <TabsContent value="skus" className="space-y-4">
            <SettlementSKUTab rows={rows} tenantId={tenantId} />
          </TabsContent>

          <TabsContent value="unmatched" className="space-y-4">
            <SettlementUnmatchedTab rows={rows} tenantId={tenantId} />
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