import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { 
  Package, 
  Plus, 
  RefreshCw, 
  Trash2, 
  Download, 
  Upload, 
  Image as ImageIcon,
  AlertCircle 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
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
  const [search, setSearch] = useState('');
  
  const [selectedRows, setSelectedRows] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedSKU, setSelectedSKU] = useState(null);
  const [showDetailsDrawer, setShowDetailsDrawer] = useState(false);

  const lowStockThreshold = tenant?.settings?.low_stock_threshold || 5;

  useEffect(() => {
    if (tenantId) loadData();
  }, [tenantId]);

  const loadData = async () => {
    setLoading(true);
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
      setLoading(false);
    }
  };

  const handleAddSKU = async ({ createSKU, createSupplier }) => {
    return {
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
  };

  const handleBulkUpload = async (file) => {
    try {
      // Upload file
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      // Extract data
      const result = await base44.integrations.Core.ExtractDataFromUploadedFile({
        file_url,
        json_schema: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sku_code: { type: 'string' },
                  product_name: { type: 'string' },
                  cost: { type: 'number' },
                  supplier: { type: 'string' },
                  stock: { type: 'number' },
                  image_url: { type: 'string' }
                }
              }
            }
          }
        }
      });

      const rows = result.output?.data || [];
      
      // Validate CSV is not empty
      if (!rows || rows.length === 0) {
        throw new Error('CSV file is empty or has no valid data rows');
      }

      // Validate required columns exist in first row
      const firstRow = rows[0];
      if (!firstRow.sku_code && !firstRow.product_name && !firstRow.cost) {
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

      let successCount = 0;
      let failedCount = 0;
      const errors = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        
        try {
          // Validation
          if (!row.sku_code || !row.product_name) {
            throw new Error('Missing required fields: sku_code or product_name');
          }

          if (!row.cost || row.cost <= 0) {
            throw new Error('Cost must be a number greater than 0');
          }

          // Check duplicate
          const existing = skus.find(s => s.sku_code === row.sku_code);
          if (existing) {
            throw new Error(`Duplicate SKU code: ${row.sku_code}`);
          }

          // Handle supplier
          let supplierId = null;
          if (row.supplier) {
            let supplier = suppliers.find(s => 
              s.supplier_name.toLowerCase() === row.supplier.toLowerCase()
            );
            
            if (!supplier) {
              // Auto-create supplier
              supplier = await base44.entities.Supplier.create({
                tenant_id: tenantId,
                supplier_name: row.supplier
              });
              suppliers.push(supplier);
            }
            supplierId = supplier.id;
          }

          // Create SKU
          const newSKU = await base44.entities.SKU.create({
            tenant_id: tenantId,
            sku_code: row.sku_code,
            product_name: row.product_name,
            cost_price: row.cost,
            supplier_id: supplierId,
            image_url: row.image_url || null,
            import_batch_id: batch.id
          });

          // Handle initial stock
          const initialStock = row.stock ? parseInt(row.stock) : 0;
          
          await base44.entities.CurrentStock.create({
            tenant_id: tenantId,
            sku_id: newSKU.id,
            sku_code: newSKU.sku_code,
            quantity_available: initialStock
          });

          if (initialStock > 0) {
            await base44.entities.StockMovement.create({
              tenant_id: tenantId,
              sku_id: newSKU.id,
              sku_code: newSKU.sku_code,
              movement_type: 'manual',
              quantity: initialStock,
              reference_type: 'batch',
              reference_id: batch.id,
              movement_date: new Date().toISOString().split('T')[0],
              notes: 'Initial stock from CSV import'
            });
          }

          successCount++;
        } catch (error) {
          failedCount++;
          await base44.entities.ImportError.create({
            tenant_id: tenantId,
            batch_id: batch.id,
            row_number: i + 1,
            raw_row_json: JSON.stringify(row),
            error_reason: error.message
          });
          errors.push({
            row_number: i + 1,
            ...row,
            error_reason: error.message
          });
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

  const handleDeleteSelected = async () => {
    try {
      const deleteResults = [];
      
      for (const skuId of selectedRows) {
        try {
          // Check if SKU is referenced
          const [orders, purchases] = await Promise.all([
            base44.entities.OrderLine.filter({ tenant_id: tenantId, sku_id: skuId }),
            base44.entities.Purchase.filter({ tenant_id: tenantId, sku_id: skuId })
          ]);

          if (orders.length > 0 || purchases.length > 0) {
            const sku = skus.find(s => s.id === skuId);
            deleteResults.push({
              sku_code: sku.sku_code,
              success: false,
              reason: 'Referenced by orders or purchases'
            });
            continue;
          }

          // Delete stock and movements
          const stockRecords = await base44.entities.CurrentStock.filter({ 
            tenant_id: tenantId, 
            sku_id: skuId 
          });
          for (const stock of stockRecords) {
            await base44.entities.CurrentStock.delete(stock.id);
          }

          const movements = await base44.entities.StockMovement.filter({ 
            tenant_id: tenantId, 
            sku_id: skuId 
          });
          for (const movement of movements) {
            await base44.entities.StockMovement.delete(movement.id);
          }

          // Delete SKU
          await base44.entities.SKU.delete(skuId);
          
          const sku = skus.find(s => s.id === skuId);
          deleteResults.push({
            sku_code: sku.sku_code,
            success: true
          });
        } catch (error) {
          const sku = skus.find(s => s.id === skuId);
          deleteResults.push({
            sku_code: sku?.sku_code || 'Unknown',
            success: false,
            reason: error.message
          });
        }
      }

      const successCount = deleteResults.filter(r => r.success).length;
      const failedCount = deleteResults.filter(r => !r.success).length;

      // Download error CSV if any failures
      if (failedCount > 0) {
        const failedItems = deleteResults.filter(r => !r.success);
        const errorCSV = [
          'sku_code,reason',
          ...failedItems.map(e => `"${e.sku_code}","${e.reason}"`)
        ].join('\n');
        
        const blob = new Blob([errorCSV], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `delete_errors_${Date.now()}.csv`;
        link.click();
      }

      toast({
        title: 'Deletion complete',
        description: `${successCount} SKUs deleted${failedCount > 0 ? `, ${failedCount} failed` : ''}`
      });

      loadData();
      setShowDeleteDialog(false);
    } catch (error) {
      toast({
        title: 'Error deleting SKUs',
        description: error.message,
        variant: 'destructive'
      });
    }
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

  const filteredSkus = skus.filter(sku =>
    sku.sku_code?.toLowerCase().includes(search.toLowerCase()) ||
    sku.product_name?.toLowerCase().includes(search.toLowerCase())
  );

  const toggleSelectAll = () => {
    if (selectedRows.length === filteredSkus.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(filteredSkus.map(s => s.id));
    }
  };

  const toggleSelectRow = (skuId) => {
    if (selectedRows.includes(skuId)) {
      setSelectedRows(selectedRows.filter(id => id !== skuId));
    } else {
      setSelectedRows([...selectedRows, skuId]);
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
            size="icon"
            onClick={loadData}
          >
            <RefreshCw className="w-4 h-4" />
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
      />

      {/* Search Bar */}
      <SKUSearchBar value={search} onChange={setSearch} />

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
                        checked={selectedRows.length === filteredSkus.length}
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
                {filteredSkus.map((sku) => {
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

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedRows.length} SKU(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              <div className="space-y-2">
                <p>This action cannot be undone. SKUs will be permanently deleted.</p>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800">
                    <strong>Warning:</strong> SKUs referenced by orders or purchases cannot be deleted. 
                    A detailed error report will be provided for failed deletions.
                  </p>
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
              Delete Selected
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}