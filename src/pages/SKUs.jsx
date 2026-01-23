import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { useDebounce } from '@/components/hooks/useDebounce';
import { 
  Package, 
  Plus, 
  Trash2, 
  Download, 
  Upload, 
  Image as ImageIcon,
  AlertCircle,
  Eraser,
  Filter,
  ArrowUpDown
} from 'lucide-react';
import RefreshButton from '@/components/shared/RefreshButton';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import TaskProgressModal from '@/components/shared/TaskProgressModal';
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
} from '@/components/ui/alert-dialog';
import PaywallBanner from '@/components/ui/PaywallBanner';
import UploadRequirementsBanner from '@/components/skus/UploadRequirementsBanner';
import SKUKPICards from '@/components/skus/SKUKPICards';
import SKUSearchBar from '@/components/skus/SKUSearchBar';
import AddSKUModal from '@/components/skus/AddSKUModal';
import BulkUploadModal from '@/components/skus/BulkUploadModal';
import SKUDetailsDrawer from '@/components/skus/SKUDetailsDrawer';
import StockIntegrityChecker from '@/components/skus/StockIntegrityChecker';
import { TableSkeleton } from '@/components/ui/LoadingSkeleton';
import EmptyState from '@/components/ui/EmptyState';

export default function SKUsPage() {
  const { tenantId, subscription, isActive, tenant, canEditPage } = useTenant();
  const { toast } = useToast();
  
  const canEdit = canEditPage('skus');
  
  const [skus, setSkus] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [currentStock, setCurrentStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [stockFilter, setStockFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  
  const [selectedRows, setSelectedRows] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showClearStockDialog, setShowClearStockDialog] = useState(false);
  const [selectedSKU, setSelectedSKU] = useState(null);
  const [showDetailsDrawer, setShowDetailsDrawer] = useState(false);
  const [showIntegrityChecker, setShowIntegrityChecker] = useState(false);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [progressState, setProgressState] = useState({
    current: 0,
    total: 0,
    successCount: 0,
    failCount: 0,
    completed: false,
    log: []
  });

  // Pagination state
  const [rowsPerPage, setRowsPerPage] = useState(() => {
    const saved = localStorage.getItem('skus_rows_per_page');
    return saved ? (saved === 'all' ? 'all' : parseInt(saved)) : 50;
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [selectAllPages, setSelectAllPages] = useState(false);
  const [showSelectAllBanner, setShowSelectAllBanner] = useState(false);

  const lowStockThreshold = tenant?.settings?.low_stock_threshold || 5;

  useEffect(() => {
    if (tenantId) loadData();
  }, [tenantId]);

  // Real-time stock updates
  useEffect(() => {
    if (!tenantId) return;
    
    const unsubscribe = base44.entities.CurrentStock.subscribe((event) => {
      if (event.type === 'update') {
        setCurrentStock(prev => prev.map(s => 
          s.id === event.id ? event.data : s
        ));
      } else if (event.type === 'create') {
        setCurrentStock(prev => [...prev, event.data]);
      } else if (event.type === 'delete') {
        setCurrentStock(prev => prev.filter(s => s.id !== event.id));
      }
    });

    return unsubscribe;
  }, [tenantId]);

  const loadData = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const [skusData, suppliersData, stockData] = await Promise.all([
        base44.entities.SKU.filter({ tenant_id: tenantId }),
        base44.entities.Supplier.filter({ tenant_id: tenantId }),
        base44.entities.CurrentStock.filter({ tenant_id: tenantId })
      ]);
      setSkus(skusData);
      setSuppliers(suppliersData);
      setCurrentStock(stockData);
      setSelectedRows([]);
    } catch (error) {
      toast({
        title: 'Error loading data',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      if (isRefresh) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  };

  const handleAddSKU = {
    createSKU: async (data) => {
      try {
        const newSKU = await base44.entities.SKU.create(data);
        
        // Create stock record if needed
        const existingStock = currentStock.find(s => s.sku_id === newSKU.id);
        if (!existingStock) {
          await base44.entities.CurrentStock.create({
            tenant_id: tenantId,
            sku_id: newSKU.id,
            sku_code: newSKU.sku_code,
            quantity_available: 0
          });
        }
        
        toast({
          title: 'SKU created successfully',
          description: `${data.sku_code} has been added to your catalog`
        });
        loadData();
      } catch (error) {
        toast({
          title: 'Error creating SKU',
          description: error.message,
          variant: 'destructive'
        });
      }
    },
    createSupplier: async (data) => {
      const newSupplier = await base44.entities.Supplier.create(data);
      setSuppliers([...suppliers, newSupplier]);
      return newSupplier;
    }
  };

  const handleBulkUpload = async (file) => {
    try {
      // Upload file
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      // Extract data - CSV returns array directly, not nested in 'data'
      const result = await base44.integrations.Core.ExtractDataFromUploadedFile({
        file_url,
        json_schema: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sku_code: { type: 'string' },
              product_name: { type: 'string' },
              cost: { type: ['number', 'string'] },
              supplier: { type: 'string' },
              stock: { type: ['number', 'string'] },
              image_url: { type: 'string' }
            }
          }
        }
      });

      let rows = result.output || [];
      
      // Validate CSV is not empty
      if (!rows || rows.length === 0) {
        throw new Error('CSV file is empty or has no valid data rows');
      }

      // Filter out completely empty rows
      rows = rows.filter(row => {
        const hasAnyData = Object.values(row).some(val => val !== null && val !== undefined && val !== '');
        return hasAnyData;
      });

      if (rows.length === 0) {
        throw new Error('CSV file contains no valid data rows');
      }

      // Normalize headers to lowercase and trim spaces
      rows = rows.map(row => {
        const normalized = {};
        Object.keys(row).forEach(key => {
          const normalizedKey = key.toLowerCase().trim();
          normalized[normalizedKey] = row[key];
        });
        return normalized;
      });

      // Validate required columns exist
      const firstRow = rows[0];
      const hasRequiredColumns = firstRow.sku_code !== undefined || 
                                 firstRow.product_name !== undefined || 
                                 firstRow.cost !== undefined;
      
      if (!hasRequiredColumns) {
        throw new Error('CSV file missing required columns. Expected: sku_code, product_name, cost');
      }
      
      // Create batch record
      const batch = await base44.entities.ImportBatch.create({
        tenant_id: tenantId,
        batch_type: 'skus',
        batch_name: `SKUs Import - ${new Date().toISOString()}`,
        filename: file.name,
        status: 'processing',
        total_rows: rows.length
      });

      // Fetch all existing SKUs once for fast duplicate checking
      const existingSKUs = await base44.entities.SKU.filter({ tenant_id: tenantId });
      const existingSKUCodesSet = new Set(existingSKUs.map(s => s.sku_code.toLowerCase().trim()));

      // Collect unique supplier names and batch create them
      const uniqueSupplierNames = new Set();
      rows.forEach(row => {
        if (row.supplier) {
          uniqueSupplierNames.add(row.supplier.toLowerCase().trim());
        }
      });

      // Fetch existing suppliers and create new ones in batch
      const supplierMap = new Map();
      if (uniqueSupplierNames.size > 0) {
        const existingSuppliers = await base44.entities.Supplier.filter({ tenant_id: tenantId });
        existingSuppliers.forEach(s => {
          supplierMap.set(s.supplier_name.toLowerCase().trim(), s.id);
        });

        const newSupplierNames = Array.from(uniqueSupplierNames)
          .filter(name => !supplierMap.has(name));

        if (newSupplierNames.length > 0) {
          const newSuppliers = await base44.entities.Supplier.bulkCreate(
            newSupplierNames.map(name => ({
              tenant_id: tenantId,
              supplier_name: name
            }))
          );
          newSuppliers.forEach(s => {
            supplierMap.set(s.supplier_name.toLowerCase().trim(), s.id);
          });
        }
      }

      let successCount = 0;
      let failedCount = 0;
      const errors = [];
      const validSKUs = [];

      // First pass: Validate all rows
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        
        try {
          // Convert cost and stock to numbers
          const costValue = typeof row.cost === 'string' ? parseFloat(row.cost) : row.cost;
          const stockValue = row.stock ? (typeof row.stock === 'string' ? parseInt(row.stock) : row.stock) : 0;

          // Validation
          if (!row.sku_code || !row.product_name) {
            throw new Error('Missing required fields: sku_code or product_name');
          }

          if (!costValue || isNaN(costValue) || costValue <= 0) {
            throw new Error('Cost must be a number greater than 0');
          }

          // Fast duplicate check using Set
          const skuCodeLower = row.sku_code.toLowerCase().trim();
          if (existingSKUCodesSet.has(skuCodeLower)) {
            throw new Error(`Duplicate SKU code: ${row.sku_code}`);
          }

          // Get supplier ID from pre-built map
          let supplierId = null;
          if (row.supplier) {
            supplierId = supplierMap.get(row.supplier.toLowerCase().trim()) || null;
          }

          // Add to valid SKUs array for bulk insert
          validSKUs.push({
            tenant_id: tenantId,
            sku_code: row.sku_code.trim(),
            product_name: row.product_name.trim(),
            cost_price: costValue,
            supplier_id: supplierId,
            image_url: row.image_url || null,
            import_batch_id: batch.id,
            _initialStock: stockValue,
            _rowNumber: i + 1
          });

          // Mark as processed in Set to prevent duplicates within same file
          existingSKUCodesSet.add(skuCodeLower);
        } catch (error) {
          failedCount++;
          errors.push({
            row_number: i + 1,
            ...row,
            error_reason: error.message
          });
        }
      }

      // Bulk insert SKUs in batches of 400 for maximum performance
      const BATCH_SIZE = 400;
      const totalBatches = Math.ceil(validSKUs.length / BATCH_SIZE);
      
      for (let i = 0; i < validSKUs.length; i += BATCH_SIZE) {
        const currentBatch = Math.floor(i / BATCH_SIZE) + 1;
        const batchToInsert = validSKUs.slice(i, i + BATCH_SIZE);
        
        // Remove temporary fields before insert
        const cleanedBatch = batchToInsert.map(({ _initialStock, _rowNumber, ...sku }) => sku);
        
        try {
          const insertedSKUs = await base44.entities.SKU.bulkCreate(cleanedBatch);
          
          // Create stock records for this batch
          const stockRecords = insertedSKUs.map((sku, idx) => ({
            tenant_id: tenantId,
            sku_id: sku.id,
            sku_code: sku.sku_code,
            quantity_available: batchToInsert[idx]._initialStock || 0
          }));
          
          await base44.entities.CurrentStock.bulkCreate(stockRecords);
          
          // Create stock movements for SKUs with initial stock
          const movementsToCreate = insertedSKUs
            .map((sku, idx) => {
              const initialStock = batchToInsert[idx]._initialStock;
              if (initialStock > 0) {
                return {
                  tenant_id: tenantId,
                  sku_id: sku.id,
                  sku_code: sku.sku_code,
                  movement_type: 'manual',
                  quantity: initialStock,
                  reference_type: 'batch',
                  reference_id: batch.id,
                  movement_date: new Date().toISOString().split('T')[0],
                  notes: 'Initial stock from CSV import'
                };
              }
              return null;
            })
            .filter(m => m !== null);
          
          if (movementsToCreate.length > 0) {
            await base44.entities.StockMovement.bulkCreate(movementsToCreate);
          }
          
          successCount += insertedSKUs.length;
          
          // Progress tracking: Log batch completion
          console.log(`Batch ${currentBatch}/${totalBatches} complete - ${successCount} SKUs processed`);
        } catch (error) {
          // If batch insert fails, mark all rows in this batch as failed
          for (const sku of batchToInsert) {
            failedCount++;
            errors.push({
              row_number: sku._rowNumber,
              sku_code: sku.sku_code,
              product_name: sku.product_name,
              cost: sku.cost_price,
              error_reason: error.message
            });
          }
        }
      }

      // Save import errors in batches
      if (errors.length > 0) {
        const errorRecords = errors.map(e => ({
          tenant_id: tenantId,
          batch_id: batch.id,
          row_number: e.row_number,
          raw_row_json: JSON.stringify(e),
          error_reason: e.error_reason
        }));
        
        const ERROR_BATCH_SIZE = 400;
        for (let i = 0; i < errorRecords.length; i += ERROR_BATCH_SIZE) {
          await base44.entities.ImportError.bulkCreate(errorRecords.slice(i, i + ERROR_BATCH_SIZE));
        }
      }

      // Generate error CSV if needed
      let errorFileUrl = null;
      if (errors.length > 0) {
        const errorCSV = [
          'row_number,sku_code,product_name,cost,supplier,stock,image_url,error_reason',
          ...errors.map(e => 
            `${e.row_number},"${e.sku_code || ''}","${e.product_name || ''}",${e.cost || ''},"${e.supplier || ''}",${e.stock || ''},"${e.image_url || ''}","${e.error_reason}"`
          )
        ].join('\n');
        
        const blob = new Blob([errorCSV], { type: 'text/csv' });
        const file = new File([blob], `errors_${batch.id}.csv`, { type: 'text/csv' });
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        errorFileUrl = file_url;
      }

      // Update batch
      const status = successCount === 0 ? 'failed' :
                     failedCount === 0 ? 'success' : 'partial';

      await base44.entities.ImportBatch.update(batch.id, {
        status,
        success_rows: successCount,
        failed_rows: failedCount,
        error_file_url: errorFileUrl
      });

      loadData();

      return {
        status,
        total_rows: rows.length,
        success_rows: successCount,
        failed_rows: failedCount,
        error_file_url: errorFileUrl
      };
    } catch (error) {
      toast({
        title: 'Upload failed',
        description: error.message,
        variant: 'destructive'
      });
      throw error;
    }
  };

  const handleUpdateSKU = async (skuId, data) => {
    try {
      await base44.entities.SKU.update(skuId, data);
      toast({
        title: 'SKU updated',
        description: 'Changes saved successfully'
      });
      loadData();
    } catch (error) {
      toast({
        title: 'Error updating SKU',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleClearStock = async () => {
    try {
      // Get all stock records for selected SKUs
      const stocksToUpdate = selectedRows
        .map(skuId => currentStock.find(s => s.sku_id === skuId))
        .filter(stock => stock !== undefined);

      // Update sequentially to avoid rate limits
      let successCount = 0;
      
      for (const stock of stocksToUpdate) {
        await base44.entities.CurrentStock.update(stock.id, {
          quantity_available: 0
        });
        successCount++;
      }

      toast({
        title: 'Stock cleared',
        description: `Stock cleared for ${successCount} items`
      });

      loadData();
      setShowClearStockDialog(false);
    } catch (error) {
      toast({
        title: 'Error clearing stock',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleDeleteSelected = async () => {
    setShowDeleteDialog(false);
    
    // Initialize progress modal
    setProgressState({
      current: 0,
      total: selectedRows.length,
      successCount: 0,
      failCount: 0,
      completed: false,
      log: []
    });
    setShowProgressModal(true);

    const BATCH_SIZE = 6; // Process 6 items at a time
    const BASE_DELAY_MS = 500; // 500ms delay between batches
    const MAX_RETRIES = 3;
    
    let current = 0;
    let successCount = 0;
    let failCount = 0;
    const log = [];
    let consecutiveRateLimitErrors = 0;

    // Retry logic with exponential backoff
    const deleteWithRetry = async (skuId, sku, retryCount = 0) => {
      const skuLabel = sku?.sku_code || skuId;
      
      try {
        // Check if SKU is referenced
        const [orders, purchases] = await Promise.all([
          base44.entities.OrderLine.filter({ tenant_id: tenantId, sku_id: skuId }),
          base44.entities.Purchase.filter({ tenant_id: tenantId, sku_id: skuId })
        ]);

        if (orders.length > 0 || purchases.length > 0) {
          throw new Error(`Referenced by ${orders.length} order(s) and ${purchases.length} purchase(s)`);
        }

        // Delete stock records
        const stockRecords = await base44.entities.CurrentStock.filter({ 
          tenant_id: tenantId, 
          sku_id: skuId 
        });
        for (const stock of stockRecords) {
          await base44.entities.CurrentStock.delete(stock.id);
        }

        // Delete stock movements
        const movements = await base44.entities.StockMovement.filter({ 
          tenant_id: tenantId, 
          sku_id: skuId 
        });
        for (const movement of movements) {
          await base44.entities.StockMovement.delete(movement.id);
        }

        // Delete SKU
        await base44.entities.SKU.delete(skuId);
        
        consecutiveRateLimitErrors = 0; // Reset on success
        return { success: true, skuLabel };
      } catch (error) {
        const isRateLimit = error.message?.toLowerCase().includes('rate limit') || 
                           error.message?.toLowerCase().includes('too many requests');
        
        if (isRateLimit && retryCount < MAX_RETRIES) {
          consecutiveRateLimitErrors++;
          const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 10000);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
          return deleteWithRetry(skuId, sku, retryCount + 1);
        }
        
        return { success: false, skuLabel, error: error.message };
      }
    };

    // Process in batches with adaptive throttling
    for (let i = 0; i < selectedRows.length; i += BATCH_SIZE) {
      const batchIds = selectedRows.slice(i, i + BATCH_SIZE);
      
      // Process batch sequentially to better control rate limits
      for (const skuId of batchIds) {
        const sku = skus.find(s => s.id === skuId);
        const result = await deleteWithRetry(skuId, sku);
        
        if (result.success) {
          successCount++;
          log.unshift({
            label: `SKU ${result.skuLabel}`,
            success: true,
            details: 'Deleted successfully'
          });
        } else {
          failCount++;
          log.unshift({
            label: `SKU ${result.skuLabel}`,
            success: false,
            error: result.error
          });
        }
        
        current++;
        
        // Update progress more frequently
        setProgressState({
          current,
          total: selectedRows.length,
          successCount,
          failCount,
          completed: false,
          log: log.slice(0, 50)
        });
        
        // Adaptive delay - increase if hitting rate limits
        const adaptiveDelay = BASE_DELAY_MS * (1 + consecutiveRateLimitErrors);
        await new Promise(resolve => setTimeout(resolve, adaptiveDelay));
      }
    }

    // Mark as completed
    const finalState = { current, total: selectedRows.length, successCount, failCount, completed: true };
    setProgressState(prev => ({ ...prev, completed: true }));

    // Generate error CSV if any failures
    if (failCount > 0) {
      const failedItems = log.filter(entry => !entry.success);
      const errorCSV = [
        'sku_code,reason',
        ...failedItems.map(e => `"${e.label.replace('SKU ', '')}","${e.error}"`)
      ].join('\n');
      
      const blob = new Blob([errorCSV], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `sku_delete_errors_${Date.now()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    }

    // Refresh data
    loadData();
  };

  const downloadTemplate = () => {
    const template = 'sku_code,product_name,cost,supplier,stock,image_url\nWGT-001,Wireless Earbuds Pro,15.50,Wholesale Mart,100,https://example.com/image.jpg';
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'skus_template.csv';
    link.click();
  };

  const handleExportCSV = () => {
    // Prepare CSV data from filtered SKUs
    const csvRows = filteredSkus.map(sku => {
      const supplier = suppliers.find(s => s.id === sku.supplier_id);
      const stock = currentStock.find(s => s.sku_id === sku.id);
      
      return [
        `"${sku.sku_code || ''}"`,
        `"${sku.product_name || ''}"`,
        sku.cost_price || 0,
        `"${supplier?.supplier_name || ''}"`,
        stock?.quantity_available || 0,
        `"${sku.image_url || ''}"`
      ].join(',');
    });

    // Add header row
    const csv = [
      'sku_code,product_name,cost,supplier,stock,image_url',
      ...csvRows
    ].join('\n');

    // Create blob with UTF-8 BOM for Arabic support in Excel
    const bom = '\uFEFF';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    // Download with timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    const link = document.createElement('a');
    link.href = url;
    link.download = `SKU_Export_${timestamp}.csv`;
    link.click();
    
    toast({
      title: 'Export successful',
      description: `Exported ${filteredSkus.length} SKUs`
    });
  };

  const filteredSkus = skus
    .filter(sku => {
      // Text search with debounced value
      const matchesSearch = sku.sku_code?.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        sku.product_name?.toLowerCase().includes(debouncedSearch.toLowerCase());
      
      // Stock filter
      const stock = currentStock.find(s => s.sku_id === sku.id);
      const qty = stock?.quantity_available || 0;
      let matchesStock = true;
      
      if (stockFilter === 'in_stock') {
        matchesStock = qty > 0;
      } else if (stockFilter === 'out_of_stock') {
        matchesStock = qty === 0;
      }
      
      return matchesSearch && matchesStock;
    })
    .sort((a, b) => {
      const stockA = currentStock.find(s => s.sku_id === a.id);
      const stockB = currentStock.find(s => s.sku_id === b.id);
      const qtyA = stockA?.quantity_available || 0;
      const qtyB = stockB?.quantity_available || 0;
      
      switch (sortBy) {
        case 'stock_high':
          return qtyB - qtyA;
        case 'stock_low':
          return qtyA - qtyB;
        case 'name_az':
          return (a.product_name || '').localeCompare(b.product_name || '');
        case 'cost_high':
          return (b.cost_price || 0) - (a.cost_price || 0);
        case 'newest':
        default:
          return new Date(b.created_date) - new Date(a.created_date);
      }
    });

  // Pagination calculations
  const totalItems = filteredSkus.length;
  const totalPages = rowsPerPage === 'all' ? 1 : Math.ceil(totalItems / rowsPerPage);
  const startIndex = rowsPerPage === 'all' ? 0 : (currentPage - 1) * rowsPerPage;
  const endIndex = rowsPerPage === 'all' ? totalItems : startIndex + rowsPerPage;
  const paginatedSkus = rowsPerPage === 'all' ? filteredSkus : filteredSkus.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
    setSelectAllPages(false);
    setShowSelectAllBanner(false);
  }, [debouncedSearch, stockFilter, sortBy]);

  // Handle rows per page change
  const handleRowsPerPageChange = (value) => {
    const newValue = value === 'all' ? 'all' : parseInt(value);
    setRowsPerPage(newValue);
    localStorage.setItem('skus_rows_per_page', value);
    setCurrentPage(1);
    setSelectAllPages(false);
    setShowSelectAllBanner(false);
  };

  const toggleSelectAll = () => {
    const currentPageIds = paginatedSkus.map(s => s.id);
    const allCurrentPageSelected = currentPageIds.every(id => selectedRows.includes(id));
    
    if (allCurrentPageSelected) {
      // Deselect all on current page
      setSelectedRows(selectedRows.filter(id => !currentPageIds.includes(id)));
      setShowSelectAllBanner(false);
      setSelectAllPages(false);
    } else {
      // Select all on current page
      const newSelection = [...new Set([...selectedRows, ...currentPageIds])];
      setSelectedRows(newSelection);
      
      // Show banner if all items on page are now selected and there are more pages
      if (newSelection.length === currentPageIds.length && totalItems > currentPageIds.length) {
        setShowSelectAllBanner(true);
      }
    }
  };

  const handleSelectAllPages = () => {
    setSelectedRows(filteredSkus.map(s => s.id));
    setSelectAllPages(true);
    setShowSelectAllBanner(false);
  };

  const toggleSelectRow = (skuId) => {
    if (selectedRows.includes(skuId)) {
      setSelectedRows(selectedRows.filter(id => id !== skuId));
      setShowSelectAllBanner(false);
      setSelectAllPages(false);
    } else {
      const newSelection = [...selectedRows, skuId];
      setSelectedRows(newSelection);
      
      // Check if all items on current page are selected
      const currentPageIds = paginatedSkus.map(s => s.id);
      const allCurrentPageSelected = currentPageIds.every(id => newSelection.includes(id));
      
      if (allCurrentPageSelected && totalItems > currentPageIds.length) {
        setShowSelectAllBanner(true);
      }
    }
  };

  const handleRowClick = (sku) => {
    setSelectedSKU(sku);
    setShowDetailsDrawer(true);
  };

  const getStockColor = (sku) => {
    const stock = currentStock.find(s => s.sku_id === sku.id);
    const qty = stock?.quantity_available || 0;
    if (qty === 0) return 'text-red-600 font-semibold';
    if (qty <= lowStockThreshold) return 'text-orange-600 font-semibold';
    return 'text-slate-700';
  };

  const getStockValue = (sku) => {
    const stock = currentStock.find(s => s.sku_id === sku.id);
    return stock?.quantity_available || 0;
  };

  return (
    <div className="space-y-6">
      <PaywallBanner subscription={subscription} onUpgrade={() => {}} />

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">SKUs / Products</h1>
          <p className="text-slate-500 mt-1">Manage your product catalog</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <RefreshButton onRefresh={() => loadData(true)} loading={refreshing} />
          {canEdit && (
            <Button 
              variant="outline" 
              onClick={() => setShowIntegrityChecker(true)}
              className="border-orange-200 text-orange-600 hover:bg-orange-50"
            >
              <AlertCircle className="w-4 h-4 mr-2" />
              Check Integrity
            </Button>
          )}
          <Button 
            variant="outline" 
            onClick={downloadTemplate}
            className="border-slate-200"
          >
            <Download className="w-4 h-4 mr-2" />
            Template
          </Button>
          <Button 
            variant="outline" 
            onClick={handleExportCSV}
            disabled={!canEdit || filteredSkus.length === 0}
            className="border-emerald-200 text-emerald-600 hover:bg-emerald-50"
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          <Button 
            variant="outline" 
            onClick={() => setShowUploadModal(true)}
            disabled={!isActive || !canEdit}
            className="border-indigo-200 text-indigo-600 hover:bg-indigo-50"
          >
            <Upload className="w-4 h-4 mr-2" />
            Bulk Upload
          </Button>
          <Button 
            onClick={() => setShowAddModal(true)}
            disabled={!isActive || !canEdit}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add SKU
          </Button>
          <Button 
            variant="outline"
            onClick={() => setShowClearStockDialog(true)}
            disabled={selectedRows.length === 0 || !canEdit}
            className="border-orange-200 text-orange-600 hover:bg-orange-50"
          >
            <Eraser className="w-4 h-4 mr-2" />
            Clear Stock ({selectedRows.length})
          </Button>
          <Button 
            variant="destructive"
            onClick={() => setShowDeleteDialog(true)}
            disabled={selectedRows.length === 0 || !canEdit}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete ({selectedRows.length})
          </Button>
        </div>
      </div>

      {/* Upload Requirements Banner */}
      <UploadRequirementsBanner />

      {/* KPI Cards */}
      <SKUKPICards 
        skus={skus} 
        currentStock={currentStock} 
        loading={loading}
        lowStockThreshold={lowStockThreshold}
        filteredSkus={filteredSkus}
      />

      {/* Search Bar & Filters */}
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1">
          <SKUSearchBar value={search} onChange={setSearch} />
        </div>
        
        <div className="flex gap-3">
          {/* Rows Per Page */}
          <Select value={rowsPerPage.toString()} onValueChange={handleRowsPerPageChange}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="25">25 rows</SelectItem>
              <SelectItem value="50">50 rows</SelectItem>
              <SelectItem value="100">100 rows</SelectItem>
              <SelectItem value="all">All rows</SelectItem>
            </SelectContent>
          </Select>
          {/* Stock Status Filter */}
          <Select value={stockFilter} onValueChange={setStockFilter}>
            <SelectTrigger className="w-48">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Stock Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Products</SelectItem>
              <SelectItem value="in_stock">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  In Stock
                </div>
              </SelectItem>
              <SelectItem value="out_of_stock">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  Out of Stock
                </div>
              </SelectItem>
            </SelectContent>
          </Select>

          {/* Sort By */}
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-52">
              <ArrowUpDown className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Sort By" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="stock_high">Stock: High to Low</SelectItem>
              <SelectItem value="stock_low">Stock: Low to High</SelectItem>
              <SelectItem value="name_az">Name: A-Z</SelectItem>
              <SelectItem value="cost_high">Cost: High to Low</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Select All Banner */}
      {showSelectAllBanner && !selectAllPages && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-indigo-600" />
            <p className="text-sm text-slate-700">
              All <strong>{paginatedSkus.length}</strong> items on this page are selected.{' '}
              <button
                onClick={handleSelectAllPages}
                className="text-indigo-600 font-semibold hover:underline"
              >
                Select all {totalItems} items in SKUs
              </button>
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowSelectAllBanner(false);
              setSelectedRows([]);
            }}
          >
            Clear
          </Button>
        </div>
      )}

      {selectAllPages && (
        <div className="bg-indigo-100 border border-indigo-300 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-indigo-700" />
            <p className="text-sm text-slate-900 font-semibold">
              All <strong>{totalItems}</strong> items in SKUs are selected.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectAllPages(false);
              setSelectedRows([]);
            }}
          >
            Clear Selection
          </Button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <TableSkeleton rows={8} cols={6} />
        </div>
      ) : filteredSkus.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100">
          <EmptyState
            icon={Package}
            title="No products yet"
            description={search ? "No products match your search" : "Add your first product to get started"}
            actionLabel={!search ? "Add SKU" : undefined}
            onAction={!search ? () => setShowAddModal(true) : undefined}
          />
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="py-4 px-6 text-left w-12">
                    {canEdit && (
                      <Checkbox
                        checked={paginatedSkus.length > 0 && paginatedSkus.every(sku => selectedRows.includes(sku.id))}
                        onCheckedChange={toggleSelectAll}
                      />
                    )}
                  </th>
                  <th className="py-4 px-6 text-left w-20 text-xs font-semibold text-slate-500 uppercase">Image</th>
                  <th className="py-4 px-6 text-left text-xs font-semibold text-slate-500 uppercase">SKU Code</th>
                  <th className="py-4 px-6 text-left text-xs font-semibold text-slate-500 uppercase">Product Name</th>
                  <th className="py-4 px-6 text-left text-xs font-semibold text-slate-500 uppercase">Supplier</th>
                  <th className="py-4 px-6 text-right text-xs font-semibold text-slate-500 uppercase">Cost</th>
                  <th className="py-4 px-6 text-right text-xs font-semibold text-slate-500 uppercase">Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {paginatedSkus.map((sku) => {
                  const supplier = suppliers.find(s => s.id === sku.supplier_id);
                  return (
                    <tr 
                      key={sku.id} 
                      className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                      onClick={(e) => {
                        if (e.target.type !== 'checkbox') {
                          handleRowClick(sku);
                        }
                      }}
                    >
                      <td className="py-4 px-6" onClick={(e) => e.stopPropagation()}>
                        {canEdit && (
                          <Checkbox
                            checked={selectedRows.includes(sku.id)}
                            onCheckedChange={() => toggleSelectRow(sku.id)}
                          />
                        )}
                      </td>
                      <td className="py-4 px-6">
                        {sku.image_url ? (
                          <img
                            src={sku.image_url}
                            alt={sku.product_name}
                            className="w-12 h-12 object-cover rounded-lg border border-slate-200"
                            onError={(e) => {
                              e.target.style.display = 'none';
                              e.target.nextSibling.style.display = 'flex';
                            }}
                          />
                        ) : null}
                        <div 
                          className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center"
                          style={{ display: sku.image_url ? 'none' : 'flex' }}
                        >
                          <ImageIcon className="w-6 h-6 text-slate-400" />
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <span className="font-semibold text-slate-900">{sku.sku_code}</span>
                      </td>
                      <td className="py-4 px-6 text-slate-700">{sku.product_name}</td>
                      <td className="py-4 px-6 text-slate-600 text-sm">
                        {supplier?.supplier_name || '-'}
                      </td>
                      <td className="py-4 px-6 text-right font-medium text-slate-900">
                        ${(sku.cost_price || 0).toFixed(2)}
                      </td>
                      <td className={`py-4 px-6 text-right ${getStockColor(sku)}`}>
                        {getStockValue(sku)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          {rowsPerPage !== 'all' && totalPages > 1 && (
            <div className="border-t border-slate-100 px-6 py-4 flex items-center justify-between">
              <div className="text-sm text-slate-600">
                Showing <strong>{startIndex + 1}</strong> to <strong>{Math.min(endIndex, totalItems)}</strong> of <strong>{totalItems}</strong> entries
              </div>
              
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    
                    return (
                      <Button
                        key={pageNum}
                        variant={currentPage === pageNum ? "default" : "outline"}
                        size="sm"
                        onClick={() => setCurrentPage(pageNum)}
                        className={currentPage === pageNum ? "bg-indigo-600" : ""}
                      >
                        {pageNum}
                      </Button>
                    );
                  })}
                </div>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <AddSKUModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleAddSKU}
        suppliers={suppliers}
        tenantId={tenantId}
      />

      <BulkUploadModal
        open={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onUpload={handleBulkUpload}
      />

      <SKUDetailsDrawer
        open={showDetailsDrawer}
        onClose={() => {
          setShowDetailsDrawer(false);
          setSelectedSKU(null);
        }}
        sku={selectedSKU}
        suppliers={suppliers}
        currentStock={currentStock}
        onUpdate={handleUpdateSKU}
      />

      <StockIntegrityChecker
        tenantId={tenantId}
        open={showIntegrityChecker}
        onClose={() => setShowIntegrityChecker(false)}
      />

      {/* Clear Stock Confirmation */}
      <AlertDialog open={showClearStockDialog} onOpenChange={setShowClearStockDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Stock for {selectedRows.length} Item(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              <div className="space-y-2">
                <p>Are you sure you want to clear the stock for {selectedRows.length} selected items? This will set their quantity to 0 and cannot be undone.</p>
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-orange-800">
                    <strong>Warning:</strong> This action will reset all stock levels to zero for the selected products.
                  </p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleClearStock}
              className="bg-orange-600 hover:bg-orange-700"
            >
              Yes, Clear Stock
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedRows.length} SKU(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              <div className="space-y-3">
                <p>This action cannot be undone. SKUs will be permanently deleted.</p>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-sm text-amber-800 font-semibold">
                      Processing Details:
                    </p>
                    <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
                      <li>SKUs will be processed in batches of 6 items</li>
                      <li>500ms delay between batches to prevent timeouts</li>
                      <li>SKUs linked to orders/purchases will be skipped</li>
                      <li>Failed deletions will be logged and exported</li>
                    </ul>
                  </div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteSelected}
              className="bg-red-600 hover:bg-red-700"
            >
              Start Deletion
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Deletion Progress Modal */}
      <TaskProgressModal
        open={showProgressModal}
        onClose={() => setShowProgressModal(false)}
        onMinimize={() => setShowProgressModal(false)}
        title="Deleting SKUs"
        current={progressState.current}
        total={progressState.total}
        successCount={progressState.successCount}
        failCount={progressState.failCount}
        completed={progressState.completed}
        log={progressState.log}
      />
    </div>
  );
}