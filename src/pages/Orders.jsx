import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { format } from 'date-fns';
import { ShoppingCart, Plus, Search, Eye, Trash2, Play, Filter, X, Edit, Save, PackageCheck, AlertTriangle } from 'lucide-react';
import RefreshButton from '@/components/shared/RefreshButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import DataTable from '@/components/shared/DataTable';
import CSVUploader from '@/components/shared/CSVUploader';
import BatchHistory from '@/components/shared/BatchHistory';
import StatusBadge from '@/components/ui/StatusBadge';
import PaywallBanner from '@/components/ui/PaywallBanner';
import UploadRequirementsBanner from '@/components/skus/UploadRequirementsBanner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';

export default function Orders() {
  const { tenantId, subscription, isActive } = useTenant();
  const { toast } = useToast();
  const [orders, setOrders] = useState([]);
  const [orderLines, setOrderLines] = useState([]);
  const [skus, setSkus] = useState([]);
  const [batches, setBatches] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [batchFilter, setBatchFilter] = useState('all');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [selectedOrders, setSelectedOrders] = useState(new Set());
  const [selectAllFiltered, setSelectAllFiltered] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [showBulkFulfillConfirm, setShowBulkFulfillConfirm] = useState(false);
  const [bulkFulfillValidation, setBulkFulfillValidation] = useState(null);
  const [currentStock, setCurrentStock] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showDetails, setShowDetails] = useState(null);
  const [editingOrder, setEditingOrder] = useState(false);
  const [editFormData, setEditFormData] = useState(null);
  const [deleteBatch, setDeleteBatch] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [formData, setFormData] = useState({
    amazon_order_id: '',
    order_date: '',
    lines: [{ sku_id: '', quantity: 1 }]
  });

  useEffect(() => {
    if (tenantId) loadData();
  }, [tenantId]);

  const loadData = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    const [ordersData, linesData, skusData, batchesData, purchasesData, stockData] = await Promise.all([
      base44.entities.Order.filter({ tenant_id: tenantId }),
      base44.entities.OrderLine.filter({ tenant_id: tenantId }),
      base44.entities.SKU.filter({ tenant_id: tenantId }),
      base44.entities.ImportBatch.filter({ tenant_id: tenantId, batch_type: 'orders' }),
      base44.entities.Purchase.filter({ tenant_id: tenantId }),
      base44.entities.CurrentStock.filter({ tenant_id: tenantId })
    ]);
    setOrders(ordersData);
    setOrderLines(linesData);
    setSkus(skusData);
    setBatches(batchesData.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)));
    setPurchases(purchasesData);
    setCurrentStock(stockData);
    if (isRefresh) {
      setRefreshing(false);
    } else {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const order = await base44.entities.Order.create({
      tenant_id: tenantId,
      amazon_order_id: formData.amazon_order_id,
      order_date: formData.order_date,
      status: 'pending'
    });

    for (const line of formData.lines) {
      if (line.sku_id && line.quantity > 0) {
        const sku = skus.find(s => s.id === line.sku_id);
        await base44.entities.OrderLine.create({
          tenant_id: tenantId,
          order_id: order.id,
          sku_id: line.sku_id,
          sku_code: sku?.sku_code,
          quantity: parseInt(line.quantity)
        });
      }
    }

    setShowForm(false);
    setFormData({ amazon_order_id: '', order_date: '', lines: [{ sku_id: '', quantity: 1 }] });
    loadData();
    toast({ title: 'Order created successfully' });
  };

  const handleFulfillOrder = async (order) => {
    const lines = orderLines.filter(l => l.order_id === order.id && !l.is_returned);
    let totalCost = 0;
    let canFulfill = true;

    // Check stock and allocate FIFO
    for (const line of lines) {
      const skuPurchases = purchases
        .filter(p => p.sku_id === line.sku_id && (p.quantity_remaining || 0) > 0)
        .sort((a, b) => new Date(a.purchase_date) - new Date(b.purchase_date));

      let remaining = line.quantity;
      let lineCost = 0;

      for (const purchase of skuPurchases) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, purchase.quantity_remaining || 0);
        lineCost += take * purchase.cost_per_unit;
        remaining -= take;
      }

      if (remaining > 0) {
        canFulfill = false;
        toast({ 
          title: 'Cannot fulfill order', 
          description: `Insufficient stock for SKU: ${line.sku_code}`,
          variant: 'destructive'
        });
        break;
      }

      totalCost += lineCost;
    }

    if (!canFulfill) return;

    // Deduct stock using FIFO
    for (const line of lines) {
      const skuPurchases = purchases
        .filter(p => p.sku_id === line.sku_id && (p.quantity_remaining || 0) > 0)
        .sort((a, b) => new Date(a.purchase_date) - new Date(b.purchase_date));

      let remaining = line.quantity;
      let lineCost = 0;

      for (const purchase of skuPurchases) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, purchase.quantity_remaining || 0);
        lineCost += take * purchase.cost_per_unit;
        
        await base44.entities.Purchase.update(purchase.id, {
          quantity_remaining: (purchase.quantity_remaining || 0) - take
        });
        
        remaining -= take;
      }

      await base44.entities.OrderLine.update(line.id, {
        unit_cost: lineCost / line.quantity,
        line_total_cost: lineCost
      });

      // Update current stock
      const stock = await base44.entities.CurrentStock.filter({ 
        tenant_id: tenantId, 
        sku_id: line.sku_id 
      });
      
      if (stock.length > 0) {
        await base44.entities.CurrentStock.update(stock[0].id, {
          quantity_available: (stock[0].quantity_available || 0) - line.quantity
        });
      }

      // Create stock movement
      await base44.entities.StockMovement.create({
        tenant_id: tenantId,
        sku_id: line.sku_id,
        sku_code: line.sku_code,
        movement_type: 'order_fulfillment',
        quantity: -line.quantity,
        reference_type: 'order_line',
        reference_id: line.id,
        movement_date: format(new Date(), 'yyyy-MM-dd')
      });
    }

    await base44.entities.Order.update(order.id, {
      status: 'fulfilled',
      total_cost: totalCost,
      profit_loss: (order.net_revenue || 0) - totalCost,
      profit_margin_percent: order.net_revenue ? (((order.net_revenue - totalCost) / order.net_revenue) * 100) : null
    });

    loadData();
    toast({ title: 'Order fulfilled successfully' });
  };

  const handleDeleteOrder = async (order) => {
    // Delete order lines
    const lines = orderLines.filter(l => l.order_id === order.id);
    for (const line of lines) {
      await base44.entities.OrderLine.delete(line.id);
    }
    await base44.entities.Order.delete(order.id);
    loadData();
    toast({ title: 'Order deleted' });
  };

  const handleEditOrder = (order) => {
    const lines = orderLines.filter(l => l.order_id === order.id);
    setEditFormData({
      ...order,
      lines: lines.map(l => ({
        id: l.id,
        sku_id: l.sku_id,
        quantity: l.quantity
      }))
    });
    setEditingOrder(true);
  };

  const handleUpdateOrder = async () => {
    if (!editFormData) return;

    // Verify order status hasn't changed
    const currentOrder = orders.find(o => o.id === editFormData.id);
    if (currentOrder?.status === 'fulfilled') {
      toast({ 
        title: 'Cannot edit order', 
        description: 'This order has been fulfilled',
        variant: 'destructive' 
      });
      return;
    }

    // Update order lines
    for (const line of editFormData.lines) {
      const sku = skus.find(s => s.id === line.sku_id);
      if (line.id) {
        // Update existing line
        await base44.entities.OrderLine.update(line.id, {
          sku_id: line.sku_id,
          sku_code: sku?.sku_code,
          quantity: parseInt(line.quantity)
        });
      } else {
        // New line
        await base44.entities.OrderLine.create({
          tenant_id: tenantId,
          order_id: editFormData.id,
          sku_id: line.sku_id,
          sku_code: sku?.sku_code,
          quantity: parseInt(line.quantity)
        });
      }
    }

    // Delete removed lines
    const existingLines = orderLines.filter(l => l.order_id === editFormData.id);
    const updatedLineIds = editFormData.lines.map(l => l.id).filter(Boolean);
    const linesToDelete = existingLines.filter(l => !updatedLineIds.includes(l.id));
    for (const line of linesToDelete) {
      await base44.entities.OrderLine.delete(line.id);
    }

    setEditingOrder(false);
    setEditFormData(null);
    setShowDetails(null);
    loadData();
    toast({ title: 'Order updated successfully' });
  };

  const addEditLine = () => {
    setEditFormData({
      ...editFormData,
      lines: [...editFormData.lines, { sku_id: '', quantity: 1 }]
    });
  };

  const updateEditLine = (index, field, value) => {
    const newLines = [...editFormData.lines];
    newLines[index][field] = value;
    setEditFormData({ ...editFormData, lines: newLines });
  };

  const removeEditLine = (index) => {
    setEditFormData({
      ...editFormData,
      lines: editFormData.lines.filter((_, i) => i !== index)
    });
  };

  const handleDeleteBatch = async () => {
    if (!deleteBatch) return;
    
    const batchOrders = orders.filter(o => o.import_batch_id === deleteBatch.id);
    
    for (const order of batchOrders) {
      // Reverse stock movements if fulfilled
      if (order.status === 'fulfilled') {
        const lines = orderLines.filter(l => l.order_id === order.id);
        for (const line of lines) {
          // Restore stock
          const stock = await base44.entities.CurrentStock.filter({ 
            tenant_id: tenantId, 
            sku_id: line.sku_id 
          });
          if (stock.length > 0) {
            await base44.entities.CurrentStock.update(stock[0].id, {
              quantity_available: (stock[0].quantity_available || 0) + line.quantity
            });
          }
        }
      }
      
      // Delete lines
      const lines = orderLines.filter(l => l.order_id === order.id);
      for (const line of lines) {
        await base44.entities.OrderLine.delete(line.id);
      }
      await base44.entities.Order.delete(order.id);
    }

    await base44.entities.ImportBatch.delete(deleteBatch.id);
    setDeleteBatch(null);
    loadData();
    toast({ title: 'Batch deleted and stock restored' });
  };

  const handleCSVUpload = async (file) => {
    setProcessing(true);
    
    try {
      // Upload file
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      // Extract data
      const result = await base44.integrations.Core.ExtractDataFromUploadedFile({
        file_url,
        json_schema: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              amazon_order_id: { type: 'string' },
              order_date: { type: 'string' },
              sku_code: { type: 'string' },
              quantity: { type: ['number', 'string'] }
            }
          }
        }
      });

      let rows = result.output || [];
      
      // Validate CSV is not empty
      if (!rows || rows.length === 0) {
        throw new Error('CSV file is empty or has no valid data rows');
      }

      // Filter out empty rows
      rows = rows.filter(row => {
        const hasAnyData = Object.values(row).some(val => val !== null && val !== undefined && val !== '');
        return hasAnyData;
      });

      if (rows.length === 0) {
        throw new Error('CSV file contains no valid data rows');
      }

      // Normalize headers
      rows = rows.map(row => {
        const normalized = {};
        Object.keys(row).forEach(key => {
          const normalizedKey = key.toLowerCase().trim();
          normalized[normalizedKey] = row[key];
        });
        return normalized;
      });

      // Create batch
      const batch = await base44.entities.ImportBatch.create({
        tenant_id: tenantId,
        batch_type: 'orders',
        batch_name: `Orders Batch - ${format(new Date(), 'yyyy-MM-dd HH:mm')}`,
        filename: file.name,
        status: 'processing',
        total_rows: rows.length
      });

      // Build SKU lookup map
      const skuMap = new Map();
      skus.forEach(sku => {
        skuMap.set(sku.sku_code.toLowerCase().trim(), sku);
      });

      // Build existing order IDs set
      const existingOrderIds = new Set(orders.map(o => o.amazon_order_id.toLowerCase().trim()));

      let successCount = 0;
      let failedCount = 0;
      const errors = [];
      const validOrders = new Map();
      const validOrderLines = [];
      const seenOrderIds = new Set();

      // Validate all rows
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        
        try {
          // Convert quantity to number
          const quantityValue = typeof row.quantity === 'string' ? parseInt(row.quantity) : row.quantity;

          // Validation
          if (!row.amazon_order_id || !row.sku_code) {
            throw new Error('Missing required fields: amazon_order_id or sku_code');
          }

          if (!row.order_date) {
            throw new Error('Missing required field: order_date');
          }

          // Validate date format
          const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
          if (!dateRegex.test(row.order_date)) {
            throw new Error('Invalid order_date format. Expected: YYYY-MM-DD');
          }

          if (!quantityValue || isNaN(quantityValue) || quantityValue <= 0) {
            throw new Error('Quantity must be a number greater than 0');
          }

          // Check if SKU exists
          const sku = skuMap.get(row.sku_code.toLowerCase().trim());
          if (!sku) {
            throw new Error(`SKU not found: ${row.sku_code}`);
          }

          // Check for duplicate order ID in existing orders
          const orderIdLower = row.amazon_order_id.toLowerCase().trim();
          if (existingOrderIds.has(orderIdLower)) {
            throw new Error(`Duplicate order ID: ${row.amazon_order_id} (already exists in system)`);
          }

          // Track order for creation (group lines by order)
          if (!validOrders.has(orderIdLower)) {
            validOrders.set(orderIdLower, {
              amazon_order_id: row.amazon_order_id.trim(),
              order_date: row.order_date,
              _rowNumber: i + 1
            });
            seenOrderIds.add(orderIdLower);
          }

          // Add order line
          validOrderLines.push({
            amazon_order_id_key: orderIdLower,
            sku_id: sku.id,
            sku_code: sku.sku_code,
            quantity: quantityValue,
            _rowNumber: i + 1,
            _originalRow: { ...row }
          });

        } catch (error) {
          failedCount++;
          errors.push({
            row_number: i + 1,
            ...row,
            error_reason: error.message
          });
        }
      }

      // Bulk create orders in batches
      const BATCH_SIZE = 400;
      const ordersToCreate = Array.from(validOrders.values()).map(({ _rowNumber, ...order }) => ({
        tenant_id: tenantId,
        ...order,
        status: 'pending',
        import_batch_id: batch.id
      }));

      const createdOrders = [];
      for (let i = 0; i < ordersToCreate.length; i += BATCH_SIZE) {
        const batchToInsert = ordersToCreate.slice(i, i + BATCH_SIZE);
        const inserted = await base44.entities.Order.bulkCreate(batchToInsert);
        createdOrders.push(...inserted);
      }

      // Build order ID to DB ID map
      const orderIdMap = new Map();
      createdOrders.forEach(order => {
        orderIdMap.set(order.amazon_order_id.toLowerCase().trim(), order.id);
      });

      // Create order lines in batches
      const linesToCreate = validOrderLines.map(({ amazon_order_id_key, _rowNumber, _originalRow, ...line }) => ({
        tenant_id: tenantId,
        order_id: orderIdMap.get(amazon_order_id_key),
        ...line
      }));

      for (let i = 0; i < linesToCreate.length; i += BATCH_SIZE) {
        const batchToInsert = linesToCreate.slice(i, i + BATCH_SIZE);
        await base44.entities.OrderLine.bulkCreate(batchToInsert);
      }

      successCount = validOrderLines.length;

      // Save import errors in batches
      if (errors.length > 0) {
        const errorRecords = errors.map(e => ({
          tenant_id: tenantId,
          batch_id: batch.id,
          row_number: e.row_number,
          raw_row_json: JSON.stringify(e),
          error_reason: e.error_reason
        }));
        
        for (let i = 0; i < errorRecords.length; i += BATCH_SIZE) {
          await base44.entities.ImportError.bulkCreate(errorRecords.slice(i, i + BATCH_SIZE));
        }

        // Generate error CSV
        const errorCSVHeaders = Object.keys(errors[0]).filter(k => k !== 'error_reason');
        errorCSVHeaders.push('error_reason');
        
        const errorCSVContent = [
          errorCSVHeaders.join(','),
          ...errors.map(e => 
            errorCSVHeaders.map(h => {
              const val = e[h];
              if (val === null || val === undefined) return '';
              const str = String(val);
              return str.includes(',') || str.includes('"') || str.includes('\n') 
                ? `"${str.replace(/"/g, '""')}"` 
                : str;
            }).join(',')
          )
        ].join('\n');

        const errorBlob = new Blob([errorCSVContent], { type: 'text/csv;charset=utf-8;' });
        const errorFile = new File([errorBlob], `errors_${batch.id}.csv`, { type: 'text/csv' });
        const { file_url: errorFileUrl } = await base44.integrations.Core.UploadFile({ file: errorFile });

        await base44.entities.ImportBatch.update(batch.id, {
          error_file_url: errorFileUrl
        });
      }

      // Determine final status
      const status = failedCount === 0 ? 'success' : 
                     successCount === 0 ? 'failed' : 'partial';

      await base44.entities.ImportBatch.update(batch.id, {
        status,
        success_rows: successCount,
        failed_rows: failedCount
      });

      // Get error file URL if there are errors
      let errorFileUrl = null;
      if (errors.length > 0) {
        const updatedBatch = await base44.entities.ImportBatch.filter({ id: batch.id });
        errorFileUrl = updatedBatch[0]?.error_file_url;
      }

      setUploadResult({
        status,
        total_rows: rows.length,
        success_rows: successCount,
        failed_rows: failedCount,
        error_file_url: errorFileUrl
      });

      loadData();
    } catch (error) {
      setUploadResult({
        status: 'failed',
        total_rows: 0,
        success_rows: 0,
        failed_rows: 0,
        error: error.message || 'Upload failed'
      });
    } finally {
      setProcessing(false);
    }
  };

  const addLine = () => {
    setFormData({
      ...formData,
      lines: [...formData.lines, { sku_id: '', quantity: 1 }]
    });
  };

  const updateLine = (index, field, value) => {
    const newLines = [...formData.lines];
    newLines[index][field] = value;
    setFormData({ ...formData, lines: newLines });
  };

  const removeLine = (index) => {
    setFormData({
      ...formData,
      lines: formData.lines.filter((_, i) => i !== index)
    });
  };

  const filteredOrders = orders.filter(order => {
    const matchesSearch = order.amazon_order_id?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
    const matchesBatch = batchFilter === 'all' || order.import_batch_id === batchFilter;
    
    let matchesDate = true;
    if (dateRange.start || dateRange.end) {
      const orderDate = new Date(order.order_date);
      if (dateRange.start) {
        matchesDate = matchesDate && orderDate >= new Date(dateRange.start);
      }
      if (dateRange.end) {
        matchesDate = matchesDate && orderDate <= new Date(dateRange.end);
      }
    }
    
    return matchesSearch && matchesStatus && matchesBatch && matchesDate;
  });

  const handleSelectAll = (checked) => {
    if (checked) {
      const newSelected = new Set(filteredOrders.map(o => o.id));
      setSelectedOrders(newSelected);
      setSelectAllFiltered(true);
    } else {
      setSelectedOrders(new Set());
      setSelectAllFiltered(false);
    }
  };

  const handleSelectOrder = (orderId, checked) => {
    const newSelected = new Set(selectedOrders);
    if (checked) {
      newSelected.add(orderId);
    } else {
      newSelected.delete(orderId);
      setSelectAllFiltered(false);
    }
    setSelectedOrders(newSelected);
  };

  const handleBulkFulfillClick = () => {
    const ordersToFulfill = orders.filter(o => selectedOrders.has(o.id) && o.status === 'pending');
    
    if (ordersToFulfill.length === 0) {
      toast({ 
        title: 'No pending orders selected', 
        description: 'Only pending orders can be fulfilled',
        variant: 'destructive' 
      });
      return;
    }

    // Validate stock availability
    const validOrders = [];
    const failedOrders = [];
    const stockIssues = [];

    ordersToFulfill.forEach(order => {
      const lines = orderLines.filter(l => l.order_id === order.id && !l.is_returned);
      let canFulfill = true;
      const orderStockIssues = [];

      lines.forEach(line => {
        const stock = currentStock.find(s => s.sku_id === line.sku_id);
        const available = stock?.quantity_available || 0;
        
        if (available < line.quantity) {
          canFulfill = false;
          orderStockIssues.push({
            sku_code: line.sku_code,
            required: line.quantity,
            available: available,
            shortage: line.quantity - available
          });
        }
      });

      if (canFulfill) {
        validOrders.push(order);
      } else {
        failedOrders.push({
          order_id: order.amazon_order_id,
          issues: orderStockIssues
        });
      }
    });

    setBulkFulfillValidation({
      validOrders,
      failedOrders,
      totalSelected: ordersToFulfill.length
    });
    setShowBulkFulfillConfirm(true);
  };

  const handleBulkFulfill = async () => {
    if (!bulkFulfillValidation || bulkFulfillValidation.validOrders.length === 0) return;

    let successCount = 0;
    let failCount = 0;

    for (const order of bulkFulfillValidation.validOrders) {
      try {
        await handleFulfillOrder(order);
        successCount++;
      } catch (error) {
        failCount++;
        console.error('Error fulfilling order:', order.amazon_order_id, error);
      }
    }

    setShowBulkFulfillConfirm(false);
    setBulkFulfillValidation(null);
    setSelectedOrders(new Set());
    setSelectAllFiltered(false);
    loadData();

    if (failCount === 0) {
      toast({ 
        title: `Successfully fulfilled ${successCount} orders`,
        description: 'Stock levels have been updated'
      });
    } else {
      toast({ 
        title: `Fulfilled ${successCount} orders, ${failCount} failed`,
        description: 'Please check the failed orders',
        variant: 'destructive'
      });
    }
  };

  const handleBulkDelete = async () => {
    const ordersToDelete = orders.filter(o => selectedOrders.has(o.id));
    
    for (const order of ordersToDelete) {
      // Reverse stock movements if fulfilled
      if (order.status === 'fulfilled') {
        const lines = orderLines.filter(l => l.order_id === order.id);
        for (const line of lines) {
          // Restore stock
          const stock = await base44.entities.CurrentStock.filter({ 
            tenant_id: tenantId, 
            sku_id: line.sku_id 
          });
          if (stock.length > 0) {
            await base44.entities.CurrentStock.update(stock[0].id, {
              quantity_available: (stock[0].quantity_available || 0) + line.quantity
            });
          }

          // Create reversal stock movement
          await base44.entities.StockMovement.create({
            tenant_id: tenantId,
            sku_id: line.sku_id,
            sku_code: line.sku_code,
            movement_type: 'manual',
            quantity: line.quantity,
            reference_type: 'manual',
            reference_id: order.id,
            movement_date: format(new Date(), 'yyyy-MM-dd'),
            notes: `Stock restored from deleted order ${order.amazon_order_id}`
          });
        }
      }
      
      // Delete order lines
      const lines = orderLines.filter(l => l.order_id === order.id);
      for (const line of lines) {
        await base44.entities.OrderLine.delete(line.id);
      }
      
      // Delete order
      await base44.entities.Order.delete(order.id);
    }

    setShowBulkDeleteConfirm(false);
    setSelectedOrders(new Set());
    setSelectAllFiltered(false);
    loadData();
    toast({ 
      title: `Successfully deleted ${ordersToDelete.length} orders`,
      description: ordersToDelete.some(o => o.status === 'fulfilled') 
        ? 'Stock has been restored for fulfilled orders'
        : undefined
    });
  };

  const setDatePreset = (preset) => {
    const today = new Date();
    const start = new Date(today);
    const end = new Date(today);
    
    switch (preset) {
      case 'today':
        break;
      case 'yesterday':
        start.setDate(start.getDate() - 1);
        end.setDate(end.getDate() - 1);
        break;
      case 'thisMonth':
        start.setDate(1);
        end.setMonth(end.getMonth() + 1);
        end.setDate(0);
        break;
      case 'lastMonth':
        start.setMonth(start.getMonth() - 1);
        start.setDate(1);
        end.setDate(0);
        break;
      default:
        setDateRange({ start: '', end: '' });
        return;
    }
    
    setDateRange({
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0]
    });
  };

  const allFilteredSelected = filteredOrders.length > 0 && 
    filteredOrders.every(o => selectedOrders.has(o.id));

  const columns = [
    {
      key: 'select',
      header: (
        <input
          type="checkbox"
          checked={allFilteredSelected}
          onChange={(e) => handleSelectAll(e.target.checked)}
          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        />
      ),
      render: (_, row) => (
        <input
          type="checkbox"
          checked={selectedOrders.has(row.id)}
          onChange={(e) => handleSelectOrder(row.id, e.target.checked)}
          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        />
      )
    },
    { 
      key: 'amazon_order_id', 
      header: 'Order ID', 
      sortable: true,
      render: (val) => <span className="font-medium text-slate-900">{val}</span>
    },
    { 
      key: 'order_date', 
      header: 'Date', 
      sortable: true,
      render: (val) => val ? format(new Date(val), 'MMM d, yyyy') : '-'
    },
    { 
      key: 'status', 
      header: 'Status',
      render: (val) => <StatusBadge status={val} />
    },
    { 
      key: 'net_revenue', 
      header: 'Revenue', 
      align: 'right',
      render: (val) => val ? `$${val.toFixed(2)}` : '-'
    },
    { 
      key: 'total_cost', 
      header: 'Cost', 
      align: 'right',
      render: (val) => val ? `$${val.toFixed(2)}` : '-'
    },
    { 
      key: 'profit_loss', 
      header: 'Profit', 
      align: 'right',
      render: (val) => val !== null ? (
        <span className={val >= 0 ? 'text-emerald-600' : 'text-red-600'}>
          ${val.toFixed(2)}
        </span>
      ) : '-'
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (_, row) => (
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="icon" onClick={() => setShowDetails(row)}>
            <Eye className="w-4 h-4" />
          </Button>
          {row.status === 'pending' && (
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => handleFulfillOrder(row)}
              className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
            >
              <Play className="w-4 h-4" />
            </Button>
          )}
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => handleDeleteOrder(row)}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      )
    }
  ];

  const csvTemplate = 'data:text/csv;charset=utf-8,amazon_order_id,order_date,sku_code,quantity\n111-1234567-1234567,2024-01-15,SKU001,2';

  return (
    <div className="space-y-6">
      <PaywallBanner subscription={subscription} onUpgrade={() => {}} />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Orders</h1>
          <p className="text-slate-500">Manage Amazon orders and fulfillment</p>
        </div>
        <div className="flex items-center gap-3">
          <RefreshButton onRefresh={() => loadData(true)} loading={refreshing} />
          <Button 
            onClick={() => setShowForm(true)}
            className="bg-indigo-600 hover:bg-indigo-700"
            disabled={!isActive}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Order
          </Button>
        </div>
      </div>

      <Tabs defaultValue="list" className="space-y-6">
        <TabsList>
          <TabsTrigger value="list">Orders List</TabsTrigger>
          <TabsTrigger value="import">Import CSV</TabsTrigger>
          <TabsTrigger value="batches">Batch History</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-6">
          <div className="flex flex-wrap gap-4">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search orders..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="fulfilled">Fulfilled</SelectItem>
                <SelectItem value="partially_returned">Partial Return</SelectItem>
                <SelectItem value="fully_returned">Full Return</SelectItem>
              </SelectContent>
            </Select>
            <Select value={batchFilter} onValueChange={setBatchFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Batch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Batches</SelectItem>
                {batches.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.batch_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date Range Filter */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Label className="text-sm font-medium text-slate-700">Date Range:</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={dateRange.start}
                    onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                    className="w-40"
                  />
                  <span className="text-slate-500">to</span>
                  <Input
                    type="date"
                    value={dateRange.end}
                    onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                    className="w-40"
                  />
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setDatePreset('today')}>
                  Today
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDatePreset('yesterday')}>
                  Yesterday
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDatePreset('thisMonth')}>
                  This Month
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDatePreset('lastMonth')}>
                  Last Month
                </Button>
                {(dateRange.start || dateRange.end) && (
                  <Button variant="ghost" size="sm" onClick={() => setDateRange({ start: '', end: '' })}>
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Bulk Action Bar */}
          {selectedOrders.size > 0 && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                    <span className="text-white font-semibold text-sm">{selectedOrders.size}</span>
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">
                      {selectedOrders.size} order{selectedOrders.size !== 1 ? 's' : ''} selected
                    </p>
                    {selectAllFiltered && filteredOrders.length === selectedOrders.size && (
                      <p className="text-xs text-slate-600">
                        All orders on this page are selected
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => {
                      setSelectedOrders(new Set());
                      setSelectAllFiltered(false);
                    }}
                  >
                    Clear Selection
                  </Button>
                  <Button 
                    size="sm"
                    onClick={handleBulkFulfillClick}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <PackageCheck className="w-4 h-4 mr-2" />
                    Fulfill Selected
                  </Button>
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={() => setShowBulkDeleteConfirm(true)}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Selected
                  </Button>
                </div>
              </div>
            </div>
          )}

          <DataTable
            columns={columns}
            data={filteredOrders}
            loading={loading}
            emptyIcon={ShoppingCart}
            emptyTitle="No orders yet"
            emptyDescription="Import orders or add them manually"
            emptyAction="Add Order"
            onEmptyAction={() => setShowForm(true)}
          />
        </TabsContent>

        <TabsContent value="import" className="space-y-4">
          <UploadRequirementsBanner 
            columns={[
              { name: 'amazon_order_id', required: true },
              { name: 'order_date', required: true },
              { name: 'sku_code', required: true },
              { name: 'quantity', required: true }
            ]}
          />
          <CSVUploader
            title="Import Orders"
            description="Upload a CSV file to bulk import orders"
            templateUrl={csvTemplate}
            templateName="orders_template.csv"
            onUpload={handleCSVUpload}
            processing={processing}
            result={uploadResult}
            onReset={() => setUploadResult(null)}
          />
        </TabsContent>

        <TabsContent value="batches">
          <BatchHistory
            batches={batches}
            loading={loading}
            onDelete={(batch) => setDeleteBatch(batch)}
          />
        </TabsContent>
      </Tabs>

      {/* Add Order Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Order</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Amazon Order ID *</Label>
                <Input
                  value={formData.amazon_order_id}
                  onChange={(e) => setFormData({...formData, amazon_order_id: e.target.value})}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Order Date *</Label>
                <Input
                  type="date"
                  value={formData.order_date}
                  onChange={(e) => setFormData({...formData, order_date: e.target.value})}
                  required
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Order Lines</Label>
                <Button type="button" variant="outline" size="sm" onClick={addLine}>
                  <Plus className="w-4 h-4 mr-1" /> Add Line
                </Button>
              </div>
              {formData.lines.map((line, i) => (
                <div key={i} className="flex gap-2">
                  <Select
                    value={line.sku_id}
                    onValueChange={(val) => updateLine(i, 'sku_id', val)}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select SKU" />
                    </SelectTrigger>
                    <SelectContent>
                      {skus.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.sku_code} - {s.product_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min="1"
                    value={line.quantity}
                    onChange={(e) => updateLine(i, 'quantity', e.target.value)}
                    className="w-20"
                  />
                  {formData.lines.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(i)}>
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700">
                Create Order
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Order Details Dialog */}
      <Dialog open={!!showDetails} onOpenChange={() => {
        setShowDetails(null);
        setEditingOrder(false);
        setEditFormData(null);
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Order Details</DialogTitle>
          </DialogHeader>
          {showDetails && (
            <div className="space-y-4">
              {/* Warning message if fulfilled */}
              {showDetails.status === 'fulfilled' && !editingOrder && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-sm text-amber-800">
                    This order is fulfilled and cannot be edited.
                  </p>
                </div>
              )}

              {!editingOrder ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-slate-500">Order ID</p>
                      <p className="font-medium">{showDetails.amazon_order_id}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">Date</p>
                      <p className="font-medium">{showDetails.order_date ? format(new Date(showDetails.order_date), 'MMM d, yyyy') : '-'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">Status</p>
                      <StatusBadge status={showDetails.status} />
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">Revenue</p>
                      <p className="font-medium">${(showDetails.net_revenue || 0).toFixed(2)}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm text-slate-500 mb-2">Order Lines</p>
                    <div className="space-y-2">
                      {orderLines.filter(l => l.order_id === showDetails.id).map(line => (
                        <div key={line.id} className="flex justify-between p-3 bg-slate-50 rounded-lg">
                          <div>
                            <p className="font-medium">{line.sku_code}</p>
                            <p className="text-sm text-slate-500">Qty: {line.quantity}</p>
                          </div>
                          <div className="text-right">
                            {line.line_total_cost && (
                              <p className="font-medium">${line.line_total_cost.toFixed(2)}</p>
                            )}
                            {line.is_returned && (
                              <StatusBadge status="fully_returned" />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {showDetails.status !== 'fulfilled' && (
                    <div className="flex justify-end pt-2">
                      <Button 
                        onClick={() => handleEditOrder(showDetails)}
                        className="bg-indigo-600 hover:bg-indigo-700"
                      >
                        <Edit className="w-4 h-4 mr-2" />
                        Edit Order
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-sm text-blue-800">
                      Editing Order: {editFormData.amazon_order_id}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Order Lines</Label>
                      <Button type="button" variant="outline" size="sm" onClick={addEditLine}>
                        <Plus className="w-4 h-4 mr-1" /> Add Line
                      </Button>
                    </div>
                    {editFormData.lines.map((line, i) => (
                      <div key={i} className="flex gap-2">
                        <Select
                          value={line.sku_id}
                          onValueChange={(val) => updateEditLine(i, 'sku_id', val)}
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Select SKU" />
                          </SelectTrigger>
                          <SelectContent>
                            {skus.map(s => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.sku_code} - {s.product_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          min="1"
                          value={line.quantity}
                          onChange={(e) => updateEditLine(i, 'quantity', e.target.value)}
                          className="w-20"
                        />
                        {editFormData.lines.length > 1 && (
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeEditLine(i)}>
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        setEditingOrder(false);
                        setEditFormData(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button 
                      onClick={handleUpdateOrder}
                      className="bg-indigo-600 hover:bg-indigo-700"
                    >
                      <Save className="w-4 h-4 mr-2" />
                      Save Changes
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Batch Confirmation */}
      <AlertDialog open={!!deleteBatch} onOpenChange={() => setDeleteBatch(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Batch?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete all orders in this batch and reverse any stock movements. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteBatch} className="bg-red-600 hover:bg-red-700">
              Delete Batch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation */}
      <AlertDialog open={showBulkDeleteConfirm} onOpenChange={setShowBulkDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedOrders.size} Orders?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the selected orders. For any fulfilled orders, stock will be automatically restored. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} className="bg-red-600 hover:bg-red-700">
              Delete Orders
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Fulfill Confirmation */}
      <AlertDialog open={showBulkFulfillConfirm} onOpenChange={setShowBulkFulfillConfirm}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Fulfill Selected Orders</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                {bulkFulfillValidation && (
                  <>
                    <p className="text-slate-600">
                      You are about to fulfill <strong>{bulkFulfillValidation.validOrders.length}</strong> order(s). 
                      This will automatically deduct the required quantities from your main inventory.
                    </p>

                    {bulkFulfillValidation.validOrders.length > 0 && (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                        <p className="text-sm font-semibold text-emerald-800 mb-1">
                          ✓ {bulkFulfillValidation.validOrders.length} order(s) ready to fulfill
                        </p>
                        <p className="text-xs text-emerald-700">
                          Sufficient stock available for all items
                        </p>
                      </div>
                    )}

                    {bulkFulfillValidation.failedOrders.length > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                        <div className="flex items-start gap-2 mb-2">
                          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-red-800 mb-2">
                              ⚠ {bulkFulfillValidation.failedOrders.length} order(s) cannot be fulfilled due to insufficient stock:
                            </p>
                            <div className="space-y-2 max-h-48 overflow-y-auto">
                              {bulkFulfillValidation.failedOrders.map((failed, idx) => (
                                <div key={idx} className="bg-red-100 rounded p-2">
                                  <p className="text-xs font-semibold text-red-900 mb-1">
                                    Order: {failed.order_id}
                                  </p>
                                  <div className="space-y-1">
                                    {failed.issues.map((issue, i) => (
                                      <p key={i} className="text-xs text-red-700">
                                        • <strong>{issue.sku_code}:</strong> Need {issue.required}, have {issue.available} 
                                        <span className="text-red-900 font-semibold"> (short {issue.shortage})</span>
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                            <p className="text-xs text-red-700 mt-2">
                              These orders will be skipped.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {bulkFulfillValidation.validOrders.length === 0 && (
                      <p className="text-sm text-red-600 font-semibold">
                        No orders can be fulfilled. Please check stock availability.
                      </p>
                    )}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowBulkFulfillConfirm(false);
              setBulkFulfillValidation(null);
            }}>
              Cancel
            </AlertDialogCancel>
            {bulkFulfillValidation?.validOrders.length > 0 && (
              <AlertDialogAction 
                onClick={handleBulkFulfill}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <PackageCheck className="w-4 h-4 mr-2" />
                Confirm & Fulfill {bulkFulfillValidation.validOrders.length} Order(s)
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}