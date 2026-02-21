import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { format } from 'date-fns';
import { Truck, Plus, Search, Edit, Trash2, ShoppingCart, Upload, AlertTriangle, ChevronDown, ChevronRight, Download, Package, Pencil, Check, X } from 'lucide-react';
import RefreshButton from '@/components/shared/RefreshButton';
import BulkUploadModal from '@/components/purchases/BulkUploadModal';
import BatchDeletionProgress from '@/components/purchases/BatchDeletionProgress';
import SKUCombobox from '@/components/purchases/SKUCombobox';
import BackfillSuppliers from '@/components/purchases/BackfillSuppliers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import DataTable from '@/components/shared/DataTable';
import PaywallBanner from '@/components/ui/PaywallBanner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import TablePagination from '@/components/shared/TablePagination';
import TaskProgressModal from '@/components/shared/TaskProgressModal';

export default function Purchases() {
  const { tenantId, subscription, isActive, isAdmin } = useTenant();
  const { toast } = useToast();
  const [purchases, setPurchases] = useState([]);
  const [batches, setBatches] = useState([]);
  const [skus, setSkus] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [cart, setCart] = useState([]);
  const [currentStock, setCurrentStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedBatches, setExpandedBatches] = useState(new Set());
  const [deletingBatch, setDeletingBatch] = useState(null);
  const [showBatchDeleteProgress, setShowBatchDeleteProgress] = useState(false);
  const [batchDeleteProgress, setBatchDeleteProgress] = useState({
    current: 0,
    total: 0,
    successCount: 0,
    failCount: 0,
    completed: false,
    log: []
  });
  const [showForm, setShowForm] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    const saved = localStorage.getItem('purchases_page_size');
    return saved ? parseInt(saved) : 25;
  });
  const [showCartForm, setShowCartForm] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [selectedPurchases, setSelectedPurchases] = useState([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteWarning, setDeleteWarning] = useState(null);
  const [deleteMode, setDeleteMode] = useState(null); // 'deduct' or 'keep'
  const [deletingPurchase, setDeletingPurchase] = useState(null);
  const [editingBatchId, setEditingBatchId] = useState(null);
  const [editBatchValue, setEditBatchValue] = useState('');
  const [savingBatchId, setSavingBatchId] = useState(null);
  const [formData, setFormData] = useState({
    sku_id: '',
    quantity_purchased: '',
    total_cost: '',
    purchase_date: format(new Date(), 'yyyy-MM-dd'),
    supplier_id: '',
    product_name: '',
    current_cost: ''
  });
  const quantityInputRef = useRef(null);
  const [cartSupplier, setCartSupplier] = useState('');
  const [cartItems, setCartItems] = useState([]);

  useEffect(() => {
    if (tenantId) loadData();
  }, [tenantId]);

  // Auto-expand newest batch on load
  useEffect(() => {
    if (batches.length > 0 && expandedBatches.size === 0) {
      setExpandedBatches(new Set([batches[0].id]));
    }
  }, [batches]);

  const loadData = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    const [purchasesData, skusData, suppliersData, cartData, stockData, batchesData] = await Promise.all([
      base44.entities.Purchase.filter({ tenant_id: tenantId }),
      base44.entities.SKU.filter({ tenant_id: tenantId }),
      base44.entities.Supplier.filter({ tenant_id: tenantId }),
      base44.entities.PurchaseCart.filter({ tenant_id: tenantId }),
      base44.entities.CurrentStock.filter({ tenant_id: tenantId }),
      base44.entities.ImportBatch.filter({ tenant_id: tenantId, batch_type: 'purchases' })
    ]);
    setPurchases(purchasesData.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)));
    setSkus(skusData);
    setSuppliers(suppliersData);
    setCart(cartData);
    setCurrentStock(stockData);
    setBatches(batchesData.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)));
    setSelectedPurchases([]);
    
    // Initialize cart items
    setCartItems(cartData.map(c => ({
      ...c,
      quantity: c.quantity_needed,
      unit_cost: skus.find(s => s.id === c.sku_id)?.cost_price || 0
    })));
    
    if (isRefresh) {
      setRefreshing(false);
    } else {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const sku = skus.find(s => s.id === formData.sku_id);
    const costPerUnit = parseFloat(formData.total_cost) / parseInt(formData.quantity_purchased);
    
    await base44.entities.Purchase.create({
      tenant_id: tenantId,
      sku_id: formData.sku_id,
      sku_code: sku?.sku_code,
      quantity_purchased: parseInt(formData.quantity_purchased),
      total_cost: parseFloat(formData.total_cost),
      cost_per_unit: costPerUnit,
      purchase_date: formData.purchase_date,
      supplier_id: formData.supplier_id || null,
      supplier_name: suppliers.find(s => s.id === formData.supplier_id)?.supplier_name,
      quantity_remaining: parseInt(formData.quantity_purchased)
    });

    // Update SKU with latest supplier
    if (formData.supplier_id) {
      await base44.entities.SKU.update(formData.sku_id, {
        supplier_id: formData.supplier_id
      });
    }

    // Update current stock
    const stock = await base44.entities.CurrentStock.filter({ 
      tenant_id: tenantId, 
      sku_id: formData.sku_id 
    });
    
    if (stock.length > 0) {
      await base44.entities.CurrentStock.update(stock[0].id, {
        quantity_available: (stock[0].quantity_available || 0) + parseInt(formData.quantity_purchased)
      });
    } else {
      await base44.entities.CurrentStock.create({
        tenant_id: tenantId,
        sku_id: formData.sku_id,
        sku_code: sku?.sku_code,
        quantity_available: parseInt(formData.quantity_purchased)
      });
    }

    // Create stock movement
    await base44.entities.StockMovement.create({
      tenant_id: tenantId,
      sku_id: formData.sku_id,
      sku_code: sku?.sku_code,
      movement_type: 'purchase',
      quantity: parseInt(formData.quantity_purchased),
      reference_type: 'purchase',
      reference_id: 'new',
      movement_date: formData.purchase_date
    });

    setShowForm(false);
    setFormData({
      sku_id: '',
      quantity_purchased: '',
      total_cost: '',
      purchase_date: format(new Date(), 'yyyy-MM-dd'),
      supplier_id: '',
      product_name: '',
      current_cost: ''
    });
    loadData();
    toast({ title: 'Purchase recorded successfully' });
  };

  const handleCartPurchase = async () => {
    const validItems = cartItems.filter(item => item.quantity > 0 && item.unit_cost > 0);
    
    if (validItems.length === 0) {
      toast({ title: 'Add quantities and costs', variant: 'destructive' });
      return;
    }

    for (const item of validItems) {
      const totalCost = item.quantity * item.unit_cost;
      
      await base44.entities.Purchase.create({
        tenant_id: tenantId,
        sku_id: item.sku_id,
        sku_code: item.sku_code,
        quantity_purchased: item.quantity,
        total_cost: totalCost,
        cost_per_unit: item.unit_cost,
        purchase_date: format(new Date(), 'yyyy-MM-dd'),
        supplier_id: cartSupplier || null,
        supplier_name: suppliers.find(s => s.id === cartSupplier)?.supplier_name,
        quantity_remaining: item.quantity
      });

      // Update SKU with latest supplier
      if (cartSupplier) {
        await base44.entities.SKU.update(item.sku_id, {
          supplier_id: cartSupplier
        });
      }

      // Update current stock
      const stock = await base44.entities.CurrentStock.filter({ 
        tenant_id: tenantId, 
        sku_id: item.sku_id 
      });
      
      if (stock.length > 0) {
        await base44.entities.CurrentStock.update(stock[0].id, {
          quantity_available: (stock[0].quantity_available || 0) + item.quantity
        });
      } else {
        await base44.entities.CurrentStock.create({
          tenant_id: tenantId,
          sku_id: item.sku_id,
          sku_code: item.sku_code,
          quantity_available: item.quantity
        });
      }

      // Create stock movement
      await base44.entities.StockMovement.create({
        tenant_id: tenantId,
        sku_id: item.sku_id,
        sku_code: item.sku_code,
        movement_type: 'purchase',
        quantity: item.quantity,
        reference_type: 'purchase',
        reference_id: 'cart',
        movement_date: format(new Date(), 'yyyy-MM-dd')
      });
    }

    // Clear cart
    for (const item of cart) {
      await base44.entities.PurchaseCart.delete(item.id);
    }

    setShowCartForm(false);
    loadData();
    toast({ title: 'Purchases recorded and stock updated' });
  };

  const handleDeleteClick = (purchase) => {
    setDeletingPurchase(purchase);
    setSelectedPurchases([purchase.id]);
    
    // Check for negative stock warning
    const stock = currentStock.find(s => s.sku_id === purchase.sku_id);
    const currentQty = stock?.quantity_available || 0;
    const newQty = currentQty - purchase.quantity_purchased;
    
    if (newQty < 0) {
      setDeleteWarning([{
        sku_code: purchase.sku_code,
        current: currentQty,
        deduct: purchase.quantity_purchased,
        result: newQty
      }]);
    } else {
      setDeleteWarning(null);
    }
    
    setDeleteMode(null);
    setShowDeleteDialog(true);
  };

  const handleBulkDeleteClick = () => {
    if (selectedPurchases.length === 0) {
      toast({ title: 'No purchases selected', variant: 'destructive' });
      return;
    }

    setDeletingPurchase(null);
    
    // Calculate total quantity and check for negative stock
    let hasNegativeStock = false;
    const warnings = [];

    selectedPurchases.forEach(purchaseId => {
      const purchase = purchases.find(p => p.id === purchaseId);
      if (purchase) {
        const stock = currentStock.find(s => s.sku_id === purchase.sku_id);
        const currentQty = stock?.quantity_available || 0;
        const newQty = currentQty - purchase.quantity_purchased;
        
        if (newQty < 0) {
          hasNegativeStock = true;
          warnings.push({
            sku_code: purchase.sku_code,
            current: currentQty,
            deduct: purchase.quantity_purchased,
            result: newQty
          });
        }
      }
    });

    setDeleteWarning(hasNegativeStock ? warnings : null);
    setDeleteMode(null);
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteMode) return;

    // If deleting a batch, show progress modal
    if (deletingBatch) {
      setShowDeleteDialog(false);
      await handleBatchDeletionWithProgress();
      return;
    }

    // Regular deletion (single/bulk without batch)
    try {
      const shouldDeductStock = deleteMode === 'deduct';
      
      // Process deletions
      for (const purchaseId of selectedPurchases) {
        const purchase = purchases.find(p => p.id === purchaseId);
        if (!purchase) continue;

        // Update stock if user chose to deduct
        if (shouldDeductStock) {
          const stock = currentStock.find(s => s.sku_id === purchase.sku_id);
          if (stock) {
            const newQty = (stock.quantity_available || 0) - purchase.quantity_purchased;
            await base44.entities.CurrentStock.update(stock.id, {
              quantity_available: newQty
            });
          }

          // Create stock movement
          await base44.entities.StockMovement.create({
            tenant_id: tenantId,
            sku_id: purchase.sku_id,
            sku_code: purchase.sku_code,
            movement_type: 'batch_delete',
            quantity: -purchase.quantity_purchased,
            reference_type: 'purchase',
            reference_id: purchase.id,
            movement_date: format(new Date(), 'yyyy-MM-dd'),
            notes: shouldDeductStock 
              ? 'Purchase deletion - stock deducted (mistake/return)'
              : 'Purchase deletion - stock kept'
          });
        }

        // Delete purchase record
        await base44.entities.Purchase.delete(purchase.id);
      }

      const action = shouldDeductStock ? 'deleted and stock deducted' : 'deleted (stock kept)';
      toast({
        title: 'Purchase(s) ' + action,
        description: `Successfully deleted ${selectedPurchases.length} record(s)`
      });

      setShowDeleteDialog(false);
      setDeleteWarning(null);
      setDeleteMode(null);
      setDeletingPurchase(null);
      loadData();
    } catch (error) {
      toast({
        title: 'Error deleting purchases',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleBatchDeletionWithProgress = async () => {
    const shouldDeductStock = deleteMode === 'deduct';
    const batchPurchases = purchases.filter(p => p.import_batch_id === deletingBatch.id);
    
    // Initialize progress
    setBatchDeleteProgress({
      current: 0,
      total: batchPurchases.length,
      successCount: 0,
      failCount: 0,
      completed: false,
      log: []
    });
    setShowBatchDeleteProgress(true);

    const results = [];
    let successCount = 0;
    let failCount = 0;

    // Process each purchase sequentially with live updates
    for (let i = 0; i < batchPurchases.length; i++) {
      const purchase = batchPurchases[i];
      
      try {
        // Update stock if deducting
        if (shouldDeductStock) {
          const stock = currentStock.find(s => s.sku_id === purchase.sku_id);
          if (stock) {
            const newQty = (stock.quantity_available || 0) - purchase.quantity_purchased;
            await base44.entities.CurrentStock.update(stock.id, {
              quantity_available: newQty
            });
          }

          // Create stock movement
          await base44.entities.StockMovement.create({
            tenant_id: tenantId,
            sku_id: purchase.sku_id,
            sku_code: purchase.sku_code,
            movement_type: 'batch_delete',
            quantity: -purchase.quantity_purchased,
            reference_type: 'purchase',
            reference_id: purchase.id,
            movement_date: format(new Date(), 'yyyy-MM-dd'),
            notes: `Batch deletion: ${deletingBatch.batch_name} - Stock ${shouldDeductStock ? 'deducted' : 'kept'}`
          });
        }

        // Delete purchase record
        await base44.entities.Purchase.delete(purchase.id);

        successCount++;
        results.push({
          skuCode: purchase.sku_code,
          success: true,
          details: shouldDeductStock 
            ? `Removed ${purchase.quantity_purchased} units from stock` 
            : 'Record deleted, stock unchanged'
        });
      } catch (error) {
        failCount++;
        results.push({
          skuCode: purchase.sku_code,
          success: false,
          error: error.message || 'Deletion failed'
        });
      }

      // Update progress after each item
      setBatchDeleteProgress(prev => ({
        ...prev,
        current: i + 1,
        successCount,
        failCount,
        log: results.slice(-50).reverse() // Keep last 50, newest first
      }));

      // Small delay to allow UI to update
      if (i < batchPurchases.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    // Delete the batch record
    try {
      await base44.entities.ImportBatch.delete(deletingBatch.id);
    } catch (error) {
      console.error('Failed to delete batch record:', error);
    }

    // Mark as complete
    setBatchDeleteProgress(prev => ({
      ...prev,
      completed: true
    }));

    // Refresh data
    loadData();
    
    // Reset state
    setDeleteWarning(null);
    setDeleteMode(null);
    setDeletingBatch(null);
  };

  const toggleSelectAll = () => {
    if (selectedPurchases.length === filteredPurchases.length) {
      setSelectedPurchases([]);
    } else {
      setSelectedPurchases(filteredPurchases.map(p => p.id));
    }
  };

  const toggleSelectPurchase = (purchaseId) => {
    if (selectedPurchases.includes(purchaseId)) {
      setSelectedPurchases(selectedPurchases.filter(id => id !== purchaseId));
    } else {
      setSelectedPurchases([...selectedPurchases, purchaseId]);
    }
  };

  const updateCartItem = (index, field, value) => {
    const newItems = [...cartItems];
    newItems[index][field] = parseFloat(value) || 0;
    setCartItems(newItems);
  };

  const clearCart = async () => {
    for (const item of cart) {
      await base44.entities.PurchaseCart.delete(item.id);
    }
    loadData();
    toast({ title: 'Cart cleared' });
  };

  const toggleBatch = (batchId) => {
    const newExpanded = new Set(expandedBatches);
    if (newExpanded.has(batchId)) {
      newExpanded.delete(batchId);
    } else {
      newExpanded.add(batchId);
    }
    setExpandedBatches(newExpanded);
  };

  const handleDeleteBatch = async (batch) => {
    setDeletingBatch(batch);
    const batchPurchases = purchases.filter(p => p.import_batch_id === batch.id);
    setSelectedPurchases(batchPurchases.map(p => p.id));
    
    // Check for negative stock warning
    let hasNegativeStock = false;
    const warnings = [];

    batchPurchases.forEach(purchase => {
      const stock = currentStock.find(s => s.sku_id === purchase.sku_id);
      const currentQty = stock?.quantity_available || 0;
      const newQty = currentQty - purchase.quantity_purchased;
      
      if (newQty < 0) {
        hasNegativeStock = true;
        warnings.push({
          sku_code: purchase.sku_code,
          current: currentQty,
          deduct: purchase.quantity_purchased,
          result: newQty
        });
      }
    });

    setDeleteWarning(hasNegativeStock ? warnings : null);
    setDeleteMode(null);
    setShowDeleteDialog(true);
  };

  const handleStartEditBatch = (batch) => {
    setEditingBatchId(batch.id);
    setEditBatchValue(batch.display_name || batch.batch_name || '');
  };

  const handleCancelEditBatch = () => {
    setEditingBatchId(null);
    setEditBatchValue('');
  };

  const handleSaveEditBatch = async (batch) => {
    const trimmedValue = editBatchValue.trim();
    
    if (trimmedValue.length > 80) {
      toast({ 
        title: 'Name too long', 
        description: 'Display name must be 80 characters or less',
        variant: 'destructive' 
      });
      return;
    }

    setSavingBatchId(batch.id);
    
    // Optimistic update
    const previousBatches = [...batches];
    setBatches(batches.map(b => 
      b.id === batch.id ? { ...b, display_name: trimmedValue || null } : b
    ));
    
    try {
      const updatedBatch = await base44.entities.ImportBatch.update(batch.id, {
        display_name: trimmedValue || null
      });

      // Verify response contains display_name
      if (!updatedBatch || updatedBatch.display_name === undefined) {
        console.warn('API response missing display_name field:', updatedBatch);
        toast({ 
          title: 'Warning',
          description: 'Rename saved but not returned by server – check API response fields',
          variant: 'destructive'
        });
        // Refresh to get server state
        loadData(true);
      } else {
        // Update with server response
        setBatches(batches.map(b => 
          b.id === batch.id ? updatedBatch : b
        ));
      }

      toast({ 
        title: 'Batch renamed successfully',
        description: trimmedValue ? `Renamed to: ${trimmedValue}` : 'Reverted to default name'
      });

      setEditingBatchId(null);
      setEditBatchValue('');
    } catch (error) {
      console.error('Failed to rename batch:', error);
      // Rollback optimistic update
      setBatches(previousBatches);
      toast({ 
        title: 'Failed to rename batch', 
        description: error.message,
        variant: 'destructive' 
      });
    } finally {
      setSavingBatchId(null);
    }
  };

  const handleBatchKeyDown = (e, batch) => {
    if (e.key === 'Enter') {
      handleSaveEditBatch(batch);
    } else if (e.key === 'Escape') {
      handleCancelEditBatch();
    }
  };

  const exportBatchCSV = (batch) => {
    const batchPurchases = purchases.filter(p => p.import_batch_id === batch.id);
    
    // Match upload structure exactly
    const headers = ['sku_code', 'quantity', 'unit_price', 'supplier_name', 'purchase_date'];
    const rows = batchPurchases.map(p => [
      p.sku_code || '',
      p.quantity_purchased || '',
      (p.cost_per_unit || 0).toFixed(2),
      p.supplier_name || '',
      p.purchase_date || ''
    ]);

    // Generate CSV with UTF-8 BOM for Excel/Arabic compatibility
    const BOM = '\uFEFF';
    const escapeCsvCell = (value) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      const needsQuoting = str.includes(',') || str.includes('"') || str.includes('\n');
      if (needsQuoting) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvContent = BOM + [
      headers.map(h => escapeCsvCell(h)).join(','),
      ...rows.map(row => row.map(cell => escapeCsvCell(cell)).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `purchases_batch_${batch.id}_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // Group purchases by batch
  const groupedPurchases = React.useMemo(() => {
    const grouped = {
      batched: {},
      unbatched: []
    };

    purchases.forEach(purchase => {
      if (purchase.import_batch_id) {
        if (!grouped.batched[purchase.import_batch_id]) {
          grouped.batched[purchase.import_batch_id] = [];
        }
        grouped.batched[purchase.import_batch_id].push(purchase);
      } else {
        grouped.unbatched.push(purchase);
      }
    });

    return grouped;
  }, [purchases]);

  const filteredPurchases = purchases.filter(p =>
    p.sku_code?.toLowerCase().includes(search.toLowerCase()) ||
    p.supplier_name?.toLowerCase().includes(search.toLowerCase())
  );

  // Paginated data
  const paginatedPurchases = filteredPurchases.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const handlePageChange = (page) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePageSizeChange = (size) => {
    setPageSize(size);
    localStorage.setItem('purchases_page_size', String(size));
    setCurrentPage(1);
  };

  const totalSelectedQty = selectedPurchases.reduce((sum, id) => {
    const purchase = purchases.find(p => p.id === id);
    return sum + (purchase?.quantity_purchased || 0);
  }, 0);

  const columns = [
    {
      key: 'select',
      header: isAdmin ? (
        <Checkbox
          checked={selectedPurchases.length === filteredPurchases.length && filteredPurchases.length > 0}
          onCheckedChange={toggleSelectAll}
        />
      ) : null,
      render: (_, row) => isAdmin ? (
        <Checkbox
          checked={selectedPurchases.includes(row.id)}
          onCheckedChange={() => toggleSelectPurchase(row.id)}
        />
      ) : null
    },
    {
      key: 'purchase_date',
      header: 'Date',
      sortable: true,
      render: (val) => format(new Date(val), 'MMM d, yyyy')
    },
    {
      key: 'sku_code',
      header: 'SKU',
      sortable: true,
      render: (val) => <span className="font-medium text-slate-900">{val}</span>
    },
    {
      key: 'supplier_name',
      header: 'Supplier',
      render: (val) => val || '-'
    },
    {
      key: 'quantity_purchased',
      header: 'Qty',
      align: 'right'
    },
    {
      key: 'cost_per_unit',
      header: 'Unit Cost',
      align: 'right',
      render: (val) => `$${(val || 0).toFixed(2)}`
    },
    {
      key: 'total_cost',
      header: 'Total',
      align: 'right',
      render: (val) => <span className="font-medium">${(val || 0).toFixed(2)}</span>
    },
    {
      key: 'quantity_remaining',
      header: 'Remaining',
      align: 'right',
      render: (val) => (
        <span className={val > 0 ? 'text-emerald-600' : 'text-slate-400'}>{val || 0}</span>
      )
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (_, row) => (
        <Button 
          variant="ghost" 
          size="icon"
          onClick={() => handleDeleteClick(row)}
          className="text-red-600 hover:text-red-700 hover:bg-red-50"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      )
    }
  ];

  const cartTotal = cartItems.reduce((sum, item) => sum + (item.quantity * item.unit_cost), 0);

  return (
    <div className="space-y-6">
      <PaywallBanner subscription={subscription} onUpgrade={() => {}} />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Purchases</h1>
          <p className="text-slate-500">Record inventory purchases</p>
        </div>
        <div className="flex flex-wrap gap-3">
           <RefreshButton onRefresh={() => loadData(true)} loading={refreshing} />
           {isAdmin && <BackfillSuppliers tenantId={tenantId} onComplete={() => loadData(true)} />}
           {isAdmin && selectedPurchases.length > 0 && (
             <Button 
               variant="destructive"
               onClick={handleBulkDeleteClick}
             >
               <Trash2 className="w-4 h-4 mr-2" />
               Delete Selected ({selectedPurchases.length} - {totalSelectedQty} units)
             </Button>
           )}
           {isAdmin && purchases.length > 0 && (
             <Button 
               variant="destructive"
               onClick={() => {
                 setSelectedPurchases(purchases.map(p => p.id));
                 setDeletingPurchase(null);
                 setDeleteWarning(null);
                 setDeleteMode(null);
                 setShowDeleteDialog(true);
               }}
             >
               <Trash2 className="w-4 h-4 mr-2" />
               Delete All ({purchases.length})
             </Button>
           )}
          {cart.length > 0 && (
            <Button 
              onClick={() => setShowCartForm(true)}
              variant="outline"
              className="border-indigo-200 text-indigo-600"
            >
              <ShoppingCart className="w-4 h-4 mr-2" />
              Cart ({cart.length})
            </Button>
          )}
          <Button 
            onClick={() => setShowBulkUpload(true)}
            variant="outline"
            className="border-indigo-200 text-indigo-600"
            disabled={!isActive}
          >
            <Upload className="w-4 h-4 mr-2" />
            Bulk Upload
          </Button>
          <Button 
            onClick={() => setShowForm(true)}
            className="bg-indigo-600 hover:bg-indigo-700"
            disabled={!isActive}
          >
            <Plus className="w-4 h-4 mr-2" />
            Record Purchase
          </Button>
        </div>
      </div>

      <Tabs defaultValue="batched" className="space-y-6">
        <TabsList>
          <TabsTrigger value="batched">Batched View</TabsTrigger>
          <TabsTrigger value="all">All Purchases</TabsTrigger>
        </TabsList>

        <TabsContent value="batched" className="space-y-4">
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Batches */}
              {batches.map(batch => {
                const batchPurchases = groupedPurchases.batched[batch.id] || [];
                const totalQty = batchPurchases.reduce((sum, p) => sum + p.quantity_purchased, 0);
                const totalCost = batchPurchases.reduce((sum, p) => sum + p.total_cost, 0);
                const isExpanded = expandedBatches.has(batch.id);

                return (
                  <div key={batch.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    {/* Batch Header */}
                    <div 
                      className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 transition-all duration-200"
                      onClick={() => toggleBatch(batch.id)}
                    >
                      <div className="flex items-center gap-3 flex-1">
                        <ChevronRight className={`w-5 h-5 text-slate-400 transition-transform duration-300 ${isExpanded ? 'rotate-90' : 'rotate-0'}`} />
                        <Package className="w-5 h-5 text-indigo-600" />
                        <div className="flex-1 min-w-0">
                          {editingBatchId === batch.id ? (
                            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                              <Input
                                value={editBatchValue}
                                onChange={(e) => setEditBatchValue(e.target.value)}
                                onKeyDown={(e) => handleBatchKeyDown(e, batch)}
                                placeholder="Enter batch name"
                                className="h-9 text-sm"
                                autoFocus
                                disabled={savingBatchId === batch.id}
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 shrink-0"
                                onClick={() => handleSaveEditBatch(batch)}
                                disabled={savingBatchId === batch.id}
                              >
                                {savingBatchId === batch.id ? (
                                  <div className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <Check className="w-4 h-4" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 text-slate-600 hover:text-slate-700 shrink-0"
                                onClick={handleCancelEditBatch}
                                disabled={savingBatchId === batch.id}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 group">
                              <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-slate-900 truncate">{batch.display_name || batch.batch_name || `Batch #${batch.id}`}</h3>
                                <p className="text-sm text-slate-500">
                                  {format(new Date(batch.created_date), 'MMM d, yyyy h:mm a')} • {batchPurchases.length} items • {totalQty.toLocaleString()} units • ${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStartEditBatch(batch);
                                }}
                              >
                                <Pencil className="w-4 h-4 text-slate-500" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => exportBatchCSV(batch)}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                        {isAdmin && (
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => handleDeleteBatch(batch)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Batch Items */}
                    <div 
                      className={`border-t border-slate-200 transition-all duration-300 ease-in-out ${
                        isExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden'
                      }`}
                    >
                      {isExpanded && (
                        <div>
                        <table className="w-full">
                          <thead className="bg-slate-50">
                            <tr>
                              <th className="text-left py-2 px-4 text-xs font-semibold text-slate-500">SKU</th>
                              <th className="text-left py-2 px-4 text-xs font-semibold text-slate-500">Supplier</th>
                              <th className="text-right py-2 px-4 text-xs font-semibold text-slate-500">Qty</th>
                              <th className="text-right py-2 px-4 text-xs font-semibold text-slate-500">Unit Cost</th>
                              <th className="text-right py-2 px-4 text-xs font-semibold text-slate-500">Total</th>
                              <th className="text-right py-2 px-4 text-xs font-semibold text-slate-500">Remaining</th>
                              <th className="w-12"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {batchPurchases.map(purchase => (
                              <tr key={purchase.id} className="border-t border-slate-100 hover:bg-slate-50">
                                <td className="py-3 px-4 font-medium text-slate-900">{purchase.sku_code}</td>
                                <td className="py-3 px-4 text-slate-600">{purchase.supplier_name || '-'}</td>
                                <td className="py-3 px-4 text-right">{purchase.quantity_purchased}</td>
                                <td className="py-3 px-4 text-right">${(purchase.cost_per_unit || 0).toFixed(2)}</td>
                                <td className="py-3 px-4 text-right font-medium">${(purchase.total_cost || 0).toFixed(2)}</td>
                                <td className="py-3 px-4 text-right">
                                  <span className={purchase.quantity_remaining > 0 ? 'text-emerald-600' : 'text-slate-400'}>
                                    {purchase.quantity_remaining || 0}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-right">
                                  <Button 
                                    variant="ghost" 
                                    size="icon"
                                    onClick={() => handleDeleteClick(purchase)}
                                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Unbatched Purchases */}
              {groupedPurchases.unbatched.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between p-4 bg-slate-50">
                    <div className="flex items-center gap-3">
                      <Package className="w-5 h-5 text-slate-400" />
                      <h3 className="font-semibold text-slate-700">Manual Entries ({groupedPurchases.unbatched.length})</h3>
                    </div>
                  </div>
                  <table className="w-full">
                    <thead className="bg-slate-50 border-t border-slate-200">
                      <tr>
                        <th className="text-left py-2 px-4 text-xs font-semibold text-slate-500">Date</th>
                        <th className="text-left py-2 px-4 text-xs font-semibold text-slate-500">SKU</th>
                        <th className="text-left py-2 px-4 text-xs font-semibold text-slate-500">Supplier</th>
                        <th className="text-right py-2 px-4 text-xs font-semibold text-slate-500">Qty</th>
                        <th className="text-right py-2 px-4 text-xs font-semibold text-slate-500">Unit Cost</th>
                        <th className="text-right py-2 px-4 text-xs font-semibold text-slate-500">Total</th>
                        <th className="text-right py-2 px-4 text-xs font-semibold text-slate-500">Remaining</th>
                        <th className="w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupedPurchases.unbatched.map(purchase => (
                        <tr key={purchase.id} className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="py-3 px-4 text-slate-600">{format(new Date(purchase.purchase_date), 'MMM d, yyyy')}</td>
                          <td className="py-3 px-4 font-medium text-slate-900">{purchase.sku_code}</td>
                          <td className="py-3 px-4 text-slate-600">{purchase.supplier_name || '-'}</td>
                          <td className="py-3 px-4 text-right">{purchase.quantity_purchased}</td>
                          <td className="py-3 px-4 text-right">${(purchase.cost_per_unit || 0).toFixed(2)}</td>
                          <td className="py-3 px-4 text-right font-medium">${(purchase.total_cost || 0).toFixed(2)}</td>
                          <td className="py-3 px-4 text-right">
                            <span className={purchase.quantity_remaining > 0 ? 'text-emerald-600' : 'text-slate-400'}>
                              {purchase.quantity_remaining || 0}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <Button 
                              variant="ghost" 
                              size="icon"
                              onClick={() => handleDeleteClick(purchase)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {batches.length === 0 && groupedPurchases.unbatched.length === 0 && (
                <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                  <Truck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <h3 className="text-lg font-medium text-slate-900 mb-1">No purchases yet</h3>
                  <p className="text-slate-500 mb-4">Record your first inventory purchase</p>
                  <Button onClick={() => setShowForm(true)} className="bg-indigo-600 hover:bg-indigo-700">
                    <Plus className="w-4 h-4 mr-2" />
                    Record Purchase
                  </Button>
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="all" className="space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search purchases..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          <div>
            <DataTable
              columns={columns}
              data={paginatedPurchases}
              loading={loading}
              emptyIcon={Truck}
              emptyTitle="No purchases yet"
              emptyDescription="Record your first inventory purchase"
              emptyAction="Record Purchase"
              onEmptyAction={() => setShowForm(true)}
            />
            {!loading && filteredPurchases.length > 0 && (
              <TablePagination
                totalItems={filteredPurchases.length}
                currentPage={currentPage}
                pageSize={pageSize}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
              />
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Add Purchase Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record Purchase</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <SKUCombobox
              skus={skus}
              value={formData.sku_id}
              onChange={(val) => {
                const selectedSku = skus.find(s => s.id === val);
                setFormData({
                  ...formData, 
                  sku_id: val,
                  // Auto-fill supplier from SKU if available
                  supplier_id: selectedSku?.supplier_id || formData.supplier_id
                });
              }}
              onProductInfo={(productName, costPrice) => {
                setFormData(prev => ({
                  ...prev,
                  product_name: productName || '',
                  current_cost: costPrice || ''
                }));
              }}
              onEnterPress={() => {
                // Focus quantity field on Enter
                quantityInputRef.current?.focus();
              }}
            />
            {formData.product_name && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                <p className="text-xs font-medium text-indigo-900 mb-1">Product Info:</p>
                <p className="text-sm text-indigo-800 font-medium">{formData.product_name}</p>
                <p className="text-xs text-indigo-600 mt-1">Current cost: ${parseFloat(formData.current_cost || 0).toFixed(2)}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Quantity *</Label>
                <Input
                  ref={quantityInputRef}
                  type="number"
                  min="1"
                  value={formData.quantity_purchased}
                  onChange={(e) => setFormData({...formData, quantity_purchased: e.target.value})}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Total Cost *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.total_cost}
                  onChange={(e) => setFormData({...formData, total_cost: e.target.value})}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Purchase Date *</Label>
                <Input
                  type="date"
                  value={formData.purchase_date}
                  onChange={(e) => setFormData({...formData, purchase_date: e.target.value})}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Supplier</Label>
                <Select
                  value={formData.supplier_id}
                  onValueChange={(val) => setFormData({...formData, supplier_id: val})}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.supplier_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {formData.quantity_purchased && formData.total_cost && (
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-sm text-slate-500">
                  Cost per unit: <span className="font-semibold text-slate-900">
                    ${(parseFloat(formData.total_cost) / parseInt(formData.quantity_purchased)).toFixed(2)}
                  </span>
                </p>
              </div>
            )}
            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700">
                Record Purchase
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Cart Purchase Dialog */}
      <Dialog open={showCartForm} onOpenChange={setShowCartForm}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Complete Purchase from Cart</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Supplier</Label>
              <Select value={cartSupplier} onValueChange={setCartSupplier}>
                <SelectTrigger>
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.supplier_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="border rounded-xl overflow-hidden max-h-96 overflow-y-auto">
              <table className="w-full">
                <thead className="bg-slate-50 sticky top-0 z-10">
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 w-16"></th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500">SKU</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500">Product</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500">Quantity</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500">Unit Cost</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {cartItems.map((item, i) => {
                    const sku = skus.find(s => s.id === item.sku_id);
                    return (
                      <tr key={item.id} className="border-t hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4">
                          {sku?.image_url ? (
                            <img 
                              src={sku.image_url} 
                              alt={item.product_name}
                              className="w-10 h-10 object-cover rounded border border-slate-200"
                              onError={(e) => {
                                e.target.style.display = 'none';
                                e.target.nextSibling.style.display = 'flex';
                              }}
                            />
                          ) : null}
                          <div 
                            className="w-10 h-10 bg-slate-100 rounded flex items-center justify-center border border-slate-200"
                            style={{ display: sku?.image_url ? 'none' : 'flex' }}
                          >
                            <Package className="w-5 h-5 text-slate-400" />
                          </div>
                        </td>
                        <td className="py-3 px-4 font-medium">{item.sku_code}</td>
                        <td className="py-3 px-4 text-slate-600">{item.product_name}</td>
                        <td className="py-3 px-4">
                          <Input
                            type="number"
                            min="0"
                            value={item.quantity}
                            onChange={(e) => updateCartItem(i, 'quantity', e.target.value)}
                            className="w-20 text-right ml-auto"
                          />
                        </td>
                        <td className="py-3 px-4">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={item.unit_cost}
                            onChange={(e) => updateCartItem(i, 'unit_cost', e.target.value)}
                            className="w-24 text-right ml-auto"
                          />
                        </td>
                        <td className="py-3 px-4 text-right font-medium">
                          ${(item.quantity * item.unit_cost).toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            <div className="bg-slate-50 rounded-lg p-4 flex justify-end">
              <div className="text-right">
                <p className="text-sm text-slate-500">Total Amount</p>
                <p className="text-2xl font-bold text-slate-900">${cartTotal.toFixed(2)}</p>
              </div>
            </div>

            <div className="flex justify-between pt-4">
              <Button type="button" variant="outline" onClick={clearCart}>
                Clear Cart
              </Button>
              <div className="flex gap-3">
                <Button type="button" variant="outline" onClick={() => setShowCartForm(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCartPurchase} className="bg-indigo-600 hover:bg-indigo-700">
                  Complete Purchase
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Upload Modal */}
      <BulkUploadModal
        open={showBulkUpload}
        onClose={() => setShowBulkUpload(false)}
        tenantId={tenantId}
        onSuccess={() => loadData()}
      />

      {/* Batch Deletion Progress Modal */}
      <TaskProgressModal
        open={showBatchDeleteProgress}
        onClose={() => {
          setShowBatchDeleteProgress(false);
          setBatchDeleteProgress({
            current: 0,
            total: 0,
            successCount: 0,
            failCount: 0,
            completed: false,
            log: []
          });
        }}
        title={`Deleting Batch: ${deletingBatch?.batch_name || 'Purchases'}`}
        current={batchDeleteProgress.current}
        total={batchDeleteProgress.total}
        successCount={batchDeleteProgress.successCount}
        failCount={batchDeleteProgress.failCount}
        completed={batchDeleteProgress.completed}
        log={batchDeleteProgress.log.map(entry => ({
          label: entry.skuCode,
          success: entry.success,
          error: entry.error,
          details: entry.details
        }))}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deletingPurchase ? 'Purchase' : `${selectedPurchases.length} Purchase(s)`}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <p className="text-slate-600">
                  {deletingPurchase ? (
                    <>Deleting purchase of <strong>{deletingPurchase.quantity_purchased} units</strong> of <strong>{deletingPurchase.sku_code}</strong></>
                  ) : (
                    <>Deleting <strong>{selectedPurchases.length} purchase record(s)</strong> totaling <strong>{totalSelectedQty} units</strong></>
                  )}
                </p>

                {deleteWarning && deleteWarning.length > 0 && deleteMode === 'deduct' && (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
                      <div className="space-y-2">
                        <p className="text-sm text-orange-800 font-semibold">
                          Warning: Deducting stock will result in negative quantities:
                        </p>
                        <div className="space-y-1 max-h-24 overflow-y-auto">
                          {deleteWarning.map((w, idx) => (
                            <div key={idx} className="text-xs text-orange-700 bg-orange-100 rounded px-2 py-1">
                              <strong>{w.sku_code}:</strong> {w.current} - {w.deduct} = <strong className="text-red-700">{w.result}</strong>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {!deleteMode && (
                  <div className="space-y-2 pt-2">
                    <p className="text-sm font-medium text-slate-700">
                      Choose how to handle stock:
                    </p>
                    <div className="grid gap-2">
                      <button
                        onClick={() => setDeleteMode('deduct')}
                        className="flex flex-col items-start gap-1 p-3 rounded-lg border-2 border-red-200 hover:border-red-400 hover:bg-red-50 transition-all text-left"
                      >
                        <span className="font-semibold text-red-700">Delete & Deduct from Stock</span>
                        <span className="text-xs text-red-600">مسح وخصم من المخزن</span>
                        <span className="text-xs text-slate-600 mt-1">
                          Use if purchase was a mistake or goods returned to supplier
                        </span>
                      </button>
                      <button
                        onClick={() => setDeleteMode('keep')}
                        className="flex flex-col items-start gap-1 p-3 rounded-lg border-2 border-slate-200 hover:border-slate-400 hover:bg-slate-50 transition-all text-left"
                      >
                        <span className="font-semibold text-slate-700">Delete Record Only</span>
                        <span className="text-xs text-slate-600">مسح السجل فقط</span>
                        <span className="text-xs text-slate-600 mt-1">
                          Use if stock should remain (e.g., fixing pricing error)
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteMode && (
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => {
                setDeleteMode(null);
                setDeletingBatch(null);
              }}>
                {deleteMode ? 'Back' : 'Cancel'}
              </AlertDialogCancel>
              <AlertDialogAction 
                onClick={() => {
                  handleConfirmDelete();
                  if (deletingBatch) {
                    base44.entities.ImportBatch.delete(deletingBatch.id);
                    setDeletingBatch(null);
                  }
                }}
                className="bg-red-600 hover:bg-red-700"
              >
                Confirm Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}