import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import DataTable from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useQuery } from '@tanstack/react-query';
import { useTenant } from '@/components/hooks/useTenant';
import { useToast } from '@/components/ui/use-toast';
import DeleteOrdersModal from './DeleteOrdersModal';
import { Trash2, RotateCcw, RefreshCw, Loader2, Calculator, AlertTriangle } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreVertical } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function SettlementOrdersTab({ rows, tenantId, onDataChange, hideRefreshButton }) {
  const [filterStatus, setFilterStatus] = useState('all');
  const [showDeleted, setShowDeleted] = useState(false);
  const [selectedOrders, setSelectedOrders] = useState(new Set());
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [ordersToDelete, setOrdersToDelete] = useState([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRematching, setIsRematching] = useState(false);
  const [isRecomputingCOGS, setIsRecomputingCOGS] = useState(false);
  const [showDebugColumns, setShowDebugColumns] = useState(false);
  const { isOwner, membership } = useTenant();
  const { toast } = useToast();

  const isAdmin = isOwner || membership?.role === 'admin';

  const { data: skus = [] } = useQuery({
    queryKey: ['skus', tenantId],
    queryFn: () => base44.entities.SKU.filter({ tenant_id: tenantId })
  });

  const { data: orders = [], refetch: refetchOrders, isFetching: isOrdersFetching } = useQuery({
    queryKey: ['orders', tenantId],
    queryFn: () => {
      console.log('fetchOrders fired', Date.now());
      return base44.entities.Order.filter({ tenant_id: tenantId, is_deleted: false });
    },
    staleTime: 0,
    cacheTime: 0
  });

  // TASK 5: Trust backend match state (not frontend re-match)
  const orderProfit = useMemo(() => {
    const orderMap = {};

    // Filter rows based on showDeleted toggle
    const filteredRows = rows.filter(row => 
      showDeleted ? row.is_deleted : !row.is_deleted
    );

    filteredRows.forEach(row => {
      const orderId = row.order_id;
      if (!orderMap[orderId]) {
        orderMap[orderId] = {
          order_id: orderId,
          net_total: 0,
          signed_units: 0,
          cogs: 0,
          cogs_source: 'missing',
          cogs_missing: false,
          matched_rows: 0,
          unmatched_rows: 0,
          rows: [],
          is_deleted: row.is_deleted || false,
          order_found: false,
          not_found_reason: null,
          match_strategy: null,
          matched_order_record_id: null,
          items_count: 0,
          items_cogs_sum: 0,
          order_cost_fields: {}
        };
      }

      orderMap[orderId].net_total += row.total;
      orderMap[orderId].signed_units += row.signed_qty;
      orderMap[orderId].rows.push(row);

      // Use backend match_status as source of truth
      if (row.match_status === 'matched' || row.match_status === 'unmatched_sku') {
        orderMap[orderId].matched_rows++;
        orderMap[orderId].order_found = true;
      } else {
        orderMap[orderId].unmatched_rows++;
      }
      
      // Track if ANY row has matched_order_id (authoritative)
      if (row.matched_order_id) {
        orderMap[orderId].order_found = true;
        orderMap[orderId].match_strategy = row.match_strategy;
        orderMap[orderId].matched_order_record_id = row.matched_order_id;
      }
      
      // Capture not_found_reason from backend
      if (row.not_found_reason) {
        orderMap[orderId].not_found_reason = row.not_found_reason;
      }
    });

    // Enrich with Orders data for COGS (display only, not boolean truth)
    const enrichedOrders = Object.values(orderMap).map(order => {
      let cogs = 0;
      let cogsSource = 'missing';
      let cogsMissing = false;
      let itemsCount = 0;
      let itemsCogsSum = 0;
      let orderCostFields = { cost: null, total_cost: null, cogs: null, order_cost: null };
      
      // Find Order entity for display enrichment (COGS)
      const firstMatchedRow = order.rows.find(r => r.matched_order_id);
      if (firstMatchedRow?.matched_order_id) {
        const enrichedOrder = orders.find(o => o.id === firstMatchedRow.matched_order_id);
        if (enrichedOrder) {
          // Check order-level fields in priority order
          const orderFields = ['cost', 'total_cost', 'cogs', 'order_cost'];
          for (const field of orderFields) {
            orderCostFields[field] = enrichedOrder[field] || null;
            if (!cogs && enrichedOrder[field] && enrichedOrder[field] > 0) {
              cogs = enrichedOrder[field];
              cogsSource = `order_field:${field}`;
            }
          }

          // If no order-level cost, would need to compute from items (would happen in recompute)
          if (!cogs) {
            cogsMissing = true;
            cogsSource = 'missing';
          }
        }
      }

      const profit = order.net_total - cogs;
      const margin = order.net_total !== 0 ? (profit / order.net_total) * 100 : 0;

      return {
        ...order,
        cogs,
        cogs_source: cogsSource,
        cogs_missing: cogsMissing,
        profit,
        margin,
        items_count: itemsCount,
        items_cogs_sum: itemsCogsSum,
        order_cost_fields: orderCostFields,
        status: !order.order_found ? 'Not Found' : order.unmatched_rows > 0 ? 'Partial' : profit < 0 ? 'Loss' : 'Profitable'
      };
    });

    // TASK 6: Check for cost data integrity issues
    const matchedWithZeroCOGS = enrichedOrders.filter(o => 
      o.order_found && o.cogs === 0 && o.cogs_missing && o.matched_rows > 0
    );

    if (matchedWithZeroCOGS.length > 0) {
      console.warn(`[SettlementOrdersTab] ${matchedWithZeroCOGS.length} matched orders have missing cost data`);
    }

    return enrichedOrders.filter(order => {
      if (filterStatus === 'profitable') return order.profit > 0;
      if (filterStatus === 'loss') return order.profit < 0;
      if (filterStatus === 'partial') return order.unmatched_rows > 0;
      if (filterStatus === 'found') return order.order_found;
      if (filterStatus === 'not_found') return !order.order_found;
      if (filterStatus === 'zero_cogs') return order.order_found && order.cogs_missing && order.matched_rows > 0;
      return true;
    });
  }, [rows, orders, filterStatus, showDeleted]);

  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedOrders(new Set(orderProfit.map(o => o.order_id)));
    } else {
      setSelectedOrders(new Set());
    }
  };

  const handleSelectOrder = (orderId, checked) => {
    const newSelected = new Set(selectedOrders);
    if (checked) {
      newSelected.add(orderId);
    } else {
      newSelected.delete(orderId);
    }
    setSelectedOrders(newSelected);
  };

  const handleDeleteSelected = () => {
    setOrdersToDelete(Array.from(selectedOrders));
    setDeleteModalOpen(true);
  };

  const handleDeleteSingle = (orderId) => {
    setOrdersToDelete([orderId]);
    setDeleteModalOpen(true);
  };

  const handleRestoreSingle = async (orderId) => {
    try {
      const { data } = await base44.functions.invoke('restoreSettlementOrders', {
        workspace_id: tenantId,
        order_ids: [orderId]
      });

      toast({
        title: 'Order Restored',
        description: data.message || `Restored ${data.affected_settlement_rows} settlement rows`
      });

      setSelectedOrders(new Set());
      if (onDataChange) onDataChange();
    } catch (error) {
      toast({
        title: 'Restore Failed',
        description: error.message || 'Failed to restore order',
        variant: 'destructive'
      });
    }
  };

  const handleRefresh = async () => {
    console.log('Refresh button clicked');
    setIsRefreshing(true);
    try {
      setFilterStatus('all');
      setShowDeleted(false);
      setSelectedOrders(new Set());

      const result = await refetchOrders();
      
      if (result.isError) {
        throw new Error('Failed to refresh');
      }

      toast({
        title: 'Refreshed Successfully',
        description: 'Orders data has been refreshed'
      });
    } catch (error) {
      toast({
        title: 'Refresh Failed',
        description: error.message || 'Failed to refresh orders',
        variant: 'destructive'
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRematch = async () => {
    setIsRematching(true);
    try {
      const response = await base44.functions.invoke('rematchSettlementOrders', {
        workspace_id: tenantId
      });

      const data = response.data;
      
      toast({
        title: 'Rematch Complete',
        description: `${data.newly_matched} newly matched, ${data.still_unmatched} still unmatched`,
        duration: 5000
      });

      // Full page reload to ensure all tabs reflect updated data
      window.location.reload();
    } catch (error) {
      toast({
        title: 'Rematch Failed',
        description: error.message || 'Failed to rematch orders',
        variant: 'destructive'
      });
      setIsRematching(false);
    }
  };

  const handleRecomputeCOGS = async () => {
    setIsRecomputingCOGS(true);
    try {
      // Get current import_id from parent
      const urlParams = new URLSearchParams(window.location.search);
      const currentImportId = urlParams.get('import_id');
      
      const response = await base44.functions.invoke('recomputeSettlementCOGS', {
        workspace_id: tenantId,
        import_id: currentImportId || null
      });

      console.log('🔧 RECOMPUTE COGS RESPONSE:', response.data);
      toast({
        title: 'Recompute Complete',
        description: 'Check browser console for full response'
      });
      setIsRecomputingCOGS(false);
    } catch (error) {
      console.error('❌ RECOMPUTE COGS ERROR:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed',
        variant: 'destructive'
      });
      setIsRecomputingCOGS(false);
    }
  };

  const confirmDelete = async () => {
    setIsDeleting(true);
    try {
      const actualOrderIds = [];
      ordersToDelete.forEach(displayOrderId => {
        const matchingRows = rows.filter(r => r.order_id === displayOrderId && !r.is_deleted);
        if (matchingRows.length > 0) {
          actualOrderIds.push(matchingRows[0].order_id);
        }
      });

      console.log('[SettlementOrdersTab] Deleting:', { displayOrderIds: ordersToDelete, actualOrderIds });

      if (actualOrderIds.length === 0) {
        throw new Error('No active settlement rows found for selected orders');
      }

      const response = await base44.functions.invoke('deleteSettlementOrders', {
        workspace_id: tenantId,
        order_ids: actualOrderIds
      });

      console.log('[SettlementOrdersTab] Delete response:', response.data);

      if (!response.data || response.data.code === 'FORBIDDEN' || response.data.code === 'ERROR') {
        throw new Error(response.data?.message || 'Delete failed');
      }

      toast({
        title: 'Orders Deleted',
        description: response.data.message || `Successfully deleted ${response.data.deleted_count} orders`
      });

      setDeleteModalOpen(false);
      setSelectedOrders(new Set());
      
      if (onDataChange) onDataChange();
    } catch (error) {
      console.error('[SettlementOrdersTab] Delete error:', error);
      toast({
        title: 'Delete Failed',
        description: error.message || 'Failed to delete orders',
        variant: 'destructive'
      });
    } finally {
      setIsDeleting(false);
    }
  };

  // TASK 6: Detect cost data integrity issues
  const matchedOrdersWithZeroCOGS = orderProfit.filter(o => 
    o.order_found && o.cogs_missing && o.matched_rows > 0
  );

  const columns = [
    ...(showDebugColumns ? [{
      key: 'matched_order_record_id',
      header: 'Record ID',
      render: (val) => val ? <span className="font-mono text-xs">{val.slice(0, 8)}...</span> : '—'
    }] : []),
    ...(showDebugColumns ? [{
      key: 'cogs_source',
      header: 'Cost Source',
      render: (val) => <span className="text-xs text-slate-600">{val}</span>
    }] : []),
    ...(showDebugColumns ? [{
      key: 'order_cost_fields',
      header: 'Cost Fields',
      render: (val) => (
        <span className="text-xs text-slate-600">
          {val.cost ? `cost: ${val.cost}` : '—'}
        </span>
      )
    }] : []),
    ...(isAdmin && !showDeleted ? [{
      key: 'select',
      header: (
        <Checkbox
          checked={selectedOrders.size === orderProfit.length && orderProfit.length > 0}
          onCheckedChange={handleSelectAll}
        />
      ),
      render: (_, row) => (
        <Checkbox
          checked={selectedOrders.has(row.order_id)}
          onCheckedChange={(checked) => handleSelectOrder(row.order_id, checked)}
        />
      ),
      width: '40px'
    }] : []),
    { 
      key: 'order_id', 
      header: 'Order ID', 
      sortable: true,
      render: (val, row) => (
        <div className="flex items-center gap-2">
          <span className={row.is_deleted ? 'text-slate-400' : ''}>{val}</span>
          {row.is_deleted && <Badge variant="outline" className="text-xs">Deleted</Badge>}
        </div>
      )
    },
    {
      key: 'order_found',
      header: 'Order Found',
      align: 'center',
      render: (val, row) => {
        if (val) {
          return (
            <div className="flex flex-col items-center gap-1">
              <span title={`Strategy: ${row.match_strategy || 'unknown'}`}>✅</span>
              {row.match_strategy && (
                <span className="text-xs text-green-600">{row.match_strategy}</span>
              )}
            </div>
          );
        } else {
          return (
            <div className="flex flex-col items-center gap-1">
              <span 
                title={row.not_found_reason || 'Not found'} 
                className="cursor-help"
              >
                ❌
              </span>
              {row.not_found_reason && (
                <span className="text-xs text-red-600 max-w-[150px] truncate" title={row.not_found_reason}>
                  {row.not_found_reason}
                </span>
              )}
            </div>
          );
        }
      }
    },
    { key: 'signed_units', header: 'Units', align: 'right' },
    {
      key: 'net_total',
      header: 'Net Revenue',
      align: 'right',
      render: (val) => `$${val.toFixed(2)}`
    },
    {
      key: 'cogs',
      header: 'Order Cost',
      align: 'right',
      render: (val, row) => (
        <div className="flex items-center justify-end gap-2">
          <div>
            <div className={row.cogs_missing ? 'text-amber-600 font-semibold' : ''}>
              ${val.toFixed(2)}
            </div>
            {row.cogs_missing && (
              <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 mt-1">
                Missing Cost
              </Badge>
            )}
          </div>
        </div>
      )
    },
    {
      key: 'profit',
      header: 'Profit',
      align: 'right',
      render: (val) => (
        <span className={val < 0 ? 'text-red-600 font-bold' : 'text-emerald-600 font-bold'}>
          ${val.toFixed(2)}
        </span>
      )
    },
    {
      key: 'margin',
      header: 'Margin',
      align: 'right',
      render: (val) => `${val.toFixed(1)}%`
    },
    {
      key: 'matched_rows',
      header: 'SKU Match',
      render: (_, row) => `${row.matched_rows} / ${row.unmatched_rows}`
    },
    ...(isAdmin ? [{
      key: 'actions',
      header: 'Actions',
      render: (_, row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {row.is_deleted ? (
              <DropdownMenuItem onClick={() => handleRestoreSingle(row.order_id)}>
                <RotateCcw className="w-4 h-4 mr-2" />
                Restore
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem 
                onClick={() => handleDeleteSingle(row.order_id)}
                className="text-red-600"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      width: '80px'
    }] : [])
  ];

  return (
    <div className="space-y-4">
      {/* TASK 6: Cost data integrity warning */}
      {matchedOrdersWithZeroCOGS.length > 0 && (
        <Alert className="bg-amber-50 border-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <AlertDescription className="flex items-center justify-between">
            <div>
              <span className="font-semibold text-amber-900">Cost data missing for {matchedOrdersWithZeroCOGS.length} matched orders</span>
              <p className="text-xs text-amber-700 mt-1">
                These orders are matched but have COGS=0. Click "Recompute COGS" to recalculate cost data from Orders.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRecomputeCOGS}
              disabled={isRecomputingCOGS}
              className="ml-4 border-amber-300 text-amber-900 hover:bg-amber-100"
            >
              {isRecomputingCOGS ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Computing...
                </>
              ) : (
                <>
                  <Calculator className="w-4 h-4 mr-2" />
                  Recompute COGS
                </>
              )}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-between items-center">
        <div className="flex gap-2 flex-wrap items-center">
          <Button
            variant={filterStatus === 'all' ? 'default' : 'outline'}
            onClick={() => setFilterStatus('all')}
            size="sm"
          >
            All
          </Button>
          <Button
            variant={filterStatus === 'found' ? 'default' : 'outline'}
            onClick={() => setFilterStatus('found')}
            size="sm"
          >
            Found
          </Button>
          <Button
            variant={filterStatus === 'not_found' ? 'default' : 'outline'}
            onClick={() => setFilterStatus('not_found')}
            size="sm"
          >
            Not Found
          </Button>
          <Button
            variant={filterStatus === 'zero_cogs' ? 'default' : 'outline'}
            onClick={() => setFilterStatus('zero_cogs')}
            size="sm"
          >
            Zero COGS
          </Button>
          <Button
            variant={filterStatus === 'profitable' ? 'default' : 'outline'}
            onClick={() => setFilterStatus('profitable')}
            size="sm"
          >
            Profitable
          </Button>
          <Button
            variant={filterStatus === 'loss' ? 'default' : 'outline'}
            onClick={() => setFilterStatus('loss')}
            size="sm"
          >
            Loss
          </Button>
          <Button
            variant={filterStatus === 'partial' ? 'default' : 'outline'}
            onClick={() => setFilterStatus('partial')}
            size="sm"
          >
            Partial SKU Match
          </Button>
          
          {isAdmin && (
            <>
              <Button
                variant={showDebugColumns ? 'default' : 'outline'}
                onClick={() => setShowDebugColumns(!showDebugColumns)}
                size="sm"
              >
                🔍 Debug
              </Button>
              <Button
                variant={showDeleted ? 'default' : 'outline'}
                onClick={() => {
                  setShowDeleted(!showDeleted);
                  setSelectedOrders(new Set());
                }}
                size="sm"
              >
                Show Deleted
              </Button>
              {!hideRefreshButton && (
                <Button
                  variant="secondary"
                  onClick={handleRefresh}
                  disabled={isRefreshing || isOrdersFetching}
                  size="sm"
                >
                  {isRefreshing || isOrdersFetching ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Refreshing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Refresh
                    </>
                  )}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={handleRematch}
                disabled={isRematching}
                size="sm"
              >
                {isRematching ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Rematching...
                  </>
                ) : (
                  '🔄 Rematch Orders'
                )}
              </Button>
            </>
          )}
        </div>

        {isAdmin && !showDeleted && selectedOrders.size > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDeleteSelected}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete Selected ({selectedOrders.size})
          </Button>
        )}
      </div>

      <DataTable columns={columns} data={orderProfit} />

      <DeleteOrdersModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        orderIds={ordersToDelete}
        onConfirm={confirmDelete}
        isDeleting={isDeleting}
      />
    </div>
  );
}