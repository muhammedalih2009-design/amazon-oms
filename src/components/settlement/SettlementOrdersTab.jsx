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
import { Trash2, RotateCcw, RefreshCw } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreVertical } from 'lucide-react';

export default function SettlementOrdersTab({ rows, tenantId, onDataChange }) {
  const [filterStatus, setFilterStatus] = useState('all');
  const [showDeleted, setShowDeleted] = useState(false);
  const [selectedOrders, setSelectedOrders] = useState(new Set());
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [ordersToDelete, setOrdersToDelete] = useState([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
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

  const normalizeOrderId = (orderId) => {
    if (!orderId) return '';
    return orderId.trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
  };

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
          matched_rows: 0,
          unmatched_rows: 0,
          rows: [],
          is_deleted: row.is_deleted || false,
          order_found: false
        };
      }

      orderMap[orderId].net_total += row.total;
      orderMap[orderId].signed_units += row.signed_qty;
      orderMap[orderId].rows.push(row);

      if (row.match_status === 'matched') {
        orderMap[orderId].matched_rows++;
      } else {
        orderMap[orderId].unmatched_rows++;
      }
    });

    // Match with Orders table and get COGS from Orders.total_cost
    return Object.values(orderMap).map(order => {
      const normalizedOrderId = normalizeOrderId(order.order_id);
      const matchedOrder = orders.find(o => normalizeOrderId(o.amazon_order_id) === normalizedOrderId);
      
      let cogs = 0;
      let orderFound = false;

      if (matchedOrder) {
        cogs = matchedOrder.total_cost || 0;
        orderFound = true;
      }

      const profit = order.net_total - cogs;
      const margin = order.net_total !== 0 ? (profit / order.net_total) * 100 : 0;

      return {
        ...order,
        cogs,
        profit,
        margin,
        order_found: orderFound,
        status: !orderFound ? 'Not Found' : order.unmatched_rows > 0 ? 'Partial' : profit < 0 ? 'Loss' : 'Profitable'
      };
    }).filter(order => {
      if (filterStatus === 'profitable') return order.profit > 0;
      if (filterStatus === 'loss') return order.profit < 0;
      if (filterStatus === 'partial') return order.unmatched_rows > 0;
      if (filterStatus === 'found') return order.order_found;
      if (filterStatus === 'not_found') return !order.order_found;
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
      // Reset filters
      setFilterStatus('all');
      setShowDeleted(false);
      setSelectedOrders(new Set());

      // Force refetch
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

  const confirmDelete = async () => {
    setIsDeleting(true);
    try {
      // Find the actual order_ids from the rows
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

  const columns = [
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
      render: (val) => val ? '✅' : '❌'
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
      header: 'COGS',
      align: 'right',
      render: (val) => `$${val.toFixed(2)}`
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
      <div className="flex justify-between items-center">
        <div className="flex gap-2 flex-wrap">
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
                variant={showDeleted ? 'default' : 'outline'}
                onClick={() => {
                  setShowDeleted(!showDeleted);
                  setSelectedOrders(new Set());
                }}
                size="sm"
              >
                Show Deleted
              </Button>
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
              <Button
                variant="outline"
                onClick={() => refetchOrders()}
                size="sm"
              >
                🔄 Recompute
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