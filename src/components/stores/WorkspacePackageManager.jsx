import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { Download, Upload, AlertTriangle, Package, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { useToast } from '@/components/ui/use-toast';
import TaskProgressModal from '@/components/shared/TaskProgressModal';

export default function WorkspacePackageManager({ tenantId, tenantName, onComplete }) {
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [uploadedPackage, setUploadedPackage] = useState(null);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [progressState, setProgressState] = useState({
    current: 0,
    total: 0,
    successCount: 0,
    failCount: 0,
    completed: false,
    log: []
  });

  const handleExport = async () => {
    setExporting(true);
    
    try {
      // Fetch all workspace data
      const [
        stores,
        skus,
        orders,
        orderLines,
        purchaseCart,
        purchases,
        suppliers,
        tasks,
        taskChecklistItems,
        taskComments,
        stockMovements,
        currentStock
      ] = await Promise.all([
        base44.entities.Store.filter({ tenant_id: tenantId }),
        base44.entities.SKU.filter({ tenant_id: tenantId }),
        base44.entities.Order.filter({ tenant_id: tenantId }),
        base44.entities.OrderLine.filter({ tenant_id: tenantId }),
        base44.entities.PurchaseCart.filter({ tenant_id: tenantId }),
        base44.entities.Purchase.filter({ tenant_id: tenantId }),
        base44.entities.Supplier.filter({ tenant_id: tenantId }),
        base44.entities.Task.filter({ tenant_id: tenantId }),
        base44.entities.TaskChecklistItem.list(),
        base44.entities.TaskComment.list(),
        base44.entities.StockMovement.filter({ tenant_id: tenantId }),
        base44.entities.CurrentStock.filter({ tenant_id: tenantId })
      ]);

      // Filter task-related items by task IDs in this tenant
      const taskIds = new Set(tasks.map(t => t.id));
      const filteredChecklistItems = taskChecklistItems.filter(item => taskIds.has(item.task_id));
      const filteredComments = taskComments.filter(comment => taskIds.has(comment.task_id));

      // Create package
      const packageData = {
        version: '1.0',
        exported_at: new Date().toISOString(),
        source_workspace: {
          id: tenantId,
          name: tenantName
        },
        tables: {
          stores,
          skus,
          orders,
          order_lines: orderLines,
          purchase_requests: purchaseCart,
          purchases,
          suppliers,
          tasks,
          task_checklist_items: filteredChecklistItems,
          task_comments: filteredComments,
          stock_movements: stockMovements,
          current_stock: currentStock
        },
        counts: {
          stores: stores.length,
          skus: skus.length,
          orders: orders.length,
          order_lines: orderLines.length,
          purchase_requests: purchaseCart.length,
          purchases: purchases.length,
          suppliers: suppliers.length,
          tasks: tasks.length,
          task_checklist_items: filteredChecklistItems.length,
          task_comments: filteredComments.length,
          stock_movements: stockMovements.length,
          current_stock: currentStock.length
        }
      };

      // Create download
      const blob = new Blob([JSON.stringify(packageData, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workspace_package_${tenantName.replace(/\s+/g, '_')}_${format(new Date(), 'yyyy-MM-dd_HHmm')}.json`;
      a.click();
      window.URL.revokeObjectURL(url);

      toast({
        title: 'Package exported successfully',
        description: `Exported ${Object.values(packageData.counts).reduce((a, b) => a + b, 0)} total records`
      });
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: 'Export failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setExporting(false);
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const packageData = JSON.parse(text);

      // Validate package structure
      if (!packageData.version || !packageData.tables || !packageData.counts) {
        throw new Error('Invalid package format');
      }

      if (packageData.version !== '1.0') {
        throw new Error(`Unsupported package version: ${packageData.version}`);
      }

      const requiredTables = ['stores', 'skus', 'orders', 'order_lines', 'purchases', 'suppliers', 'tasks'];
      const missingTables = requiredTables.filter(table => !packageData.tables[table]);
      if (missingTables.length > 0) {
        throw new Error(`Package missing required tables: ${missingTables.join(', ')}`);
      }

      setUploadedPackage(packageData);
      setShowConfirmDialog(true);
      setConfirmText('');
    } catch (error) {
      toast({
        title: 'Invalid package file',
        description: error.message,
        variant: 'destructive'
      });
    }

    // Reset input
    event.target.value = '';
  };

  const handleConfirmImport = async () => {
    if (confirmText !== 'REPLACE') {
      toast({
        title: 'Confirmation required',
        description: 'Please type REPLACE to confirm',
        variant: 'destructive'
      });
      return;
    }

    setShowConfirmDialog(false);
    setImporting(true);
    setShowProgressModal(true);
    
    const totalSteps = 12; // Number of entity types
    let currentStep = 0;
    const log = [];

    const updateProgress = (step, label, success, details = '') => {
      currentStep = step;
      const newLog = {
        label,
        success,
        details,
        error: success ? '' : details
      };
      log.unshift(newLog);
      
      setProgressState({
        current: currentStep,
        total: totalSteps,
        successCount: log.filter(l => l.success).length,
        failCount: log.filter(l => !l.success).length,
        completed: false,
        log: log.slice(0, 50)
      });
    };

    try {
      const pkg = uploadedPackage;
      const idMaps = {
        stores: new Map(),
        skus: new Map(),
        orders: new Map(),
        suppliers: new Map(),
        tasks: new Map()
      };

      // Step 1: Delete all current data in reverse dependency order
      updateProgress(1, 'Deleting current stock', true, 'Preparing workspace...');
      
      const currentData = await Promise.all([
        base44.entities.CurrentStock.filter({ tenant_id: tenantId }),
        base44.entities.StockMovement.filter({ tenant_id: tenantId }),
        base44.entities.TaskComment.list(),
        base44.entities.TaskChecklistItem.list(),
        base44.entities.Task.filter({ tenant_id: tenantId }),
        base44.entities.OrderLine.filter({ tenant_id: tenantId }),
        base44.entities.Order.filter({ tenant_id: tenantId }),
        base44.entities.Purchase.filter({ tenant_id: tenantId }),
        base44.entities.PurchaseCart.filter({ tenant_id: tenantId }),
        base44.entities.SKU.filter({ tenant_id: tenantId }),
        base44.entities.Store.filter({ tenant_id: tenantId }),
        base44.entities.Supplier.filter({ tenant_id: tenantId })
      ]);

      // Delete in order (children first)
      for (const stock of currentData[0]) {
        await base44.entities.CurrentStock.delete(stock.id);
      }
      updateProgress(2, 'Clearing stock movements', true, `Deleted ${currentData[0].length} stock records`);

      for (const movement of currentData[1]) {
        await base44.entities.StockMovement.delete(movement.id);
      }
      updateProgress(3, 'Clearing task data', true, `Deleted ${currentData[1].length} movements`);

      // Delete task comments and checklist items
      const taskIds = new Set(currentData[4].map(t => t.id));
      for (const comment of currentData[2].filter(c => taskIds.has(c.task_id))) {
        await base44.entities.TaskComment.delete(comment.id);
      }
      for (const item of currentData[3].filter(i => taskIds.has(i.task_id))) {
        await base44.entities.TaskChecklistItem.delete(item.id);
      }
      for (const task of currentData[4]) {
        await base44.entities.Task.delete(task.id);
      }
      updateProgress(4, 'Clearing orders', true, `Deleted ${currentData[4].length} tasks`);

      for (const line of currentData[5]) {
        await base44.entities.OrderLine.delete(line.id);
      }
      for (const order of currentData[6]) {
        await base44.entities.Order.delete(order.id);
      }
      updateProgress(5, 'Clearing purchases', true, `Deleted ${currentData[6].length} orders`);

      for (const purchase of currentData[7]) {
        await base44.entities.Purchase.delete(purchase.id);
      }
      for (const cart of currentData[8]) {
        await base44.entities.PurchaseCart.delete(cart.id);
      }
      updateProgress(6, 'Clearing SKUs', true, `Deleted ${currentData[7].length} purchases`);

      for (const sku of currentData[9]) {
        await base44.entities.SKU.delete(sku.id);
      }
      updateProgress(7, 'Clearing stores & suppliers', true, `Deleted ${currentData[9].length} SKUs`);

      for (const store of currentData[10]) {
        await base44.entities.Store.delete(store.id);
      }
      for (const supplier of currentData[11]) {
        await base44.entities.Supplier.delete(supplier.id);
      }

      // Step 2: Import package data with new IDs
      updateProgress(8, 'Importing suppliers & stores', true, 'Creating foundation data...');

      // Import suppliers first
      for (const supplier of pkg.tables.suppliers || []) {
        const { id, created_date, updated_date, created_by, ...data } = supplier;
        const newSupplier = await base44.entities.Supplier.create({
          ...data,
          tenant_id: tenantId
        });
        idMaps.suppliers.set(id, newSupplier.id);
      }

      // Import stores
      for (const store of pkg.tables.stores) {
        const { id, created_date, updated_date, created_by, ...data } = store;
        const newStore = await base44.entities.Store.create({
          ...data,
          tenant_id: tenantId
        });
        idMaps.stores.set(id, newStore.id);
      }
      updateProgress(9, 'Importing SKUs', true, `Created ${pkg.tables.stores.length} stores, ${pkg.tables.suppliers.length} suppliers`);

      // Import SKUs with mapped supplier_id
      for (const sku of pkg.tables.skus) {
        const { id, created_date, updated_date, created_by, supplier_id, ...data } = sku;
        const newSku = await base44.entities.SKU.create({
          ...data,
          tenant_id: tenantId,
          supplier_id: supplier_id ? idMaps.suppliers.get(supplier_id) : null
        });
        idMaps.skus.set(id, newSku.id);
      }
      updateProgress(10, 'Importing orders', true, `Created ${pkg.tables.skus.length} SKUs`);

      // Import orders with mapped store_id
      for (const order of pkg.tables.orders) {
        const { id, created_date, updated_date, created_by, store_id, ...data } = order;
        const newOrder = await base44.entities.Order.create({
          ...data,
          tenant_id: tenantId,
          store_id: idMaps.stores.get(store_id)
        });
        idMaps.orders.set(id, newOrder.id);
      }

      // Import order lines with mapped IDs
      for (const line of pkg.tables.order_lines) {
        const { id, created_date, updated_date, created_by, order_id, sku_id, actual_sku_id, ...data } = line;
        await base44.entities.OrderLine.create({
          ...data,
          tenant_id: tenantId,
          order_id: idMaps.orders.get(order_id),
          sku_id: idMaps.skus.get(sku_id),
          actual_sku_id: actual_sku_id ? idMaps.skus.get(actual_sku_id) : null
        });
      }
      updateProgress(11, 'Importing purchases & tasks', true, `Created ${pkg.tables.orders.length} orders`);

      // Import purchases with mapped SKU IDs
      for (const purchase of pkg.tables.purchases) {
        const { id, created_date, updated_date, created_by, sku_id, supplier_id, ...data } = purchase;
        await base44.entities.Purchase.create({
          ...data,
          tenant_id: tenantId,
          sku_id: idMaps.skus.get(sku_id),
          supplier_id: supplier_id ? idMaps.suppliers.get(supplier_id) : null
        });
      }

      // Import purchase cart
      for (const cart of pkg.tables.purchase_requests || []) {
        const { id, created_date, updated_date, created_by, sku_id, suggested_supplier_id, ...data } = cart;
        await base44.entities.PurchaseCart.create({
          ...data,
          tenant_id: tenantId,
          sku_id: idMaps.skus.get(sku_id),
          suggested_supplier_id: suggested_supplier_id ? idMaps.suppliers.get(suggested_supplier_id) : null
        });
      }

      // Import tasks
      for (const task of pkg.tables.tasks) {
        const { id, created_date, updated_date, ...data } = task;
        const newTask = await base44.entities.Task.create({
          ...data,
          tenant_id: tenantId
        });
        idMaps.tasks.set(id, newTask.id);
      }

      // Import task checklist items
      for (const item of pkg.tables.task_checklist_items || []) {
        const { id, created_date, updated_date, created_by, task_id, ...data } = item;
        await base44.entities.TaskChecklistItem.create({
          ...data,
          task_id: idMaps.tasks.get(task_id)
        });
      }

      // Import task comments
      for (const comment of pkg.tables.task_comments || []) {
        const { id, created_date, updated_date, created_by, task_id, ...data } = comment;
        await base44.entities.TaskComment.create({
          ...data,
          task_id: idMaps.tasks.get(task_id)
        });
      }

      // Import stock movements with mapped IDs
      for (const movement of pkg.tables.stock_movements || []) {
        const { id, created_date, updated_date, created_by, sku_id, ...data } = movement;
        await base44.entities.StockMovement.create({
          ...data,
          tenant_id: tenantId,
          sku_id: idMaps.skus.get(sku_id)
        });
      }

      // Import current stock with mapped SKU IDs
      for (const stock of pkg.tables.current_stock || []) {
        const { id, created_date, updated_date, created_by, sku_id, ...data } = stock;
        await base44.entities.CurrentStock.create({
          ...data,
          tenant_id: tenantId,
          sku_id: idMaps.skus.get(sku_id)
        });
      }

      updateProgress(12, 'Import completed', true, `Successfully imported all ${Object.values(pkg.counts).reduce((a, b) => a + b, 0)} records`);

      setProgressState(prev => ({
        ...prev,
        completed: true
      }));

      toast({
        title: 'Workspace restored successfully',
        description: `Imported ${Object.values(pkg.counts).reduce((a, b) => a + b, 0)} total records from ${pkg.source_workspace.name}`
      });

      // Refresh parent
      if (onComplete) {
        setTimeout(() => {
          onComplete();
        }, 2000);
      }
    } catch (error) {
      console.error('Import error:', error);
      updateProgress(currentStep, 'Import failed', false, error.message);
      setProgressState(prev => ({
        ...prev,
        completed: true
      }));
      toast({
        title: 'Import failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setImporting(false);
      setUploadedPackage(null);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <div className="flex items-start gap-4 mb-6">
        <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center shrink-0">
          <Package className="w-6 h-6 text-indigo-600" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-slate-900 mb-1">Workspace Data Package</h3>
          <p className="text-sm text-slate-600">
            Export all workspace data to a single file, or import a package to replace current data.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-2">What's included in the package:</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>Stores & Sales Channels</li>
                <li>SKUs / Products (image URLs only, no files)</li>
                <li>Orders & Order Lines</li>
                <li>Purchase Requests & Purchases</li>
                <li>Suppliers</li>
                <li>Tasks, Checklist Items & Comments</li>
                <li>Stock Movements & Current Stock</li>
              </ul>
              <p className="mt-2 font-medium text-blue-900">
                Note: Importing will REPLACE all current workspace data. This cannot be undone.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            onClick={handleExport}
            disabled={exporting}
            className="bg-indigo-600 hover:bg-indigo-700 flex-1"
          >
            {exporting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Download Workspace Package
              </>
            )}
          </Button>

          <div className="flex-1">
            <Label htmlFor="package-upload" className="cursor-pointer">
              <div className={`
                flex items-center justify-center gap-2 h-10 px-4 rounded-md font-medium text-sm
                border-2 border-orange-500 text-orange-700 hover:bg-orange-50 transition-colors
                ${importing ? 'opacity-50 pointer-events-none' : ''}
              `}>
                <Upload className="w-4 h-4" />
                Upload & Replace Workspace
              </div>
            </Label>
            <Input
              id="package-upload"
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              disabled={importing}
              className="hidden"
            />
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-orange-700">
              <AlertTriangle className="w-6 h-6" />
              Replace Workspace Data?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <div className="bg-orange-50 border-2 border-orange-300 rounded-lg p-4">
                  <p className="text-sm font-semibold text-orange-900 mb-2">
                    ⚠️ WARNING: This will DELETE and REPLACE all data in this workspace
                  </p>
                  <p className="text-sm text-orange-800">
                    All current stores, SKUs, orders, purchases, tasks, and related data will be permanently deleted
                    and replaced with the package contents. This action cannot be undone.
                  </p>
                </div>

                {uploadedPackage && (
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-sm font-medium text-slate-900 mb-2">Package Info:</p>
                    <div className="space-y-1 text-xs text-slate-700">
                      <p>Source: <strong>{uploadedPackage.source_workspace.name}</strong></p>
                      <p>Exported: <strong>{format(new Date(uploadedPackage.exported_at), 'MMM d, yyyy h:mm a')}</strong></p>
                      <p>Total Records: <strong>{Object.values(uploadedPackage.counts).reduce((a, b) => a + b, 0)}</strong></p>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-slate-900">
                    Type <span className="font-mono bg-slate-100 px-2 py-0.5 rounded">REPLACE</span> to confirm:
                  </Label>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="Type REPLACE"
                    className="font-mono"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowConfirmDialog(false);
              setUploadedPackage(null);
              setConfirmText('');
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmImport}
              disabled={confirmText !== 'REPLACE'}
              className="bg-orange-600 hover:bg-orange-700"
            >
              <AlertTriangle className="w-4 h-4 mr-2" />
              Replace Workspace Data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Progress Modal */}
      <TaskProgressModal
        open={showProgressModal}
        onClose={() => {
          setShowProgressModal(false);
          setProgressState({
            current: 0,
            total: 0,
            successCount: 0,
            failCount: 0,
            completed: false,
            log: []
          });
        }}
        title="Restoring Workspace Data"
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