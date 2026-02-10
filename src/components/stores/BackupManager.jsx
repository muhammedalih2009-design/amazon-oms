import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Database, Download, Upload, Trash2, AlertTriangle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
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
import { format } from 'date-fns';

export default function BackupManager({ tenantId }) {
  const { toast } = useToast();
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [backupName, setBackupName] = useState('');
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState(null);
  const [uploadingFile, setUploadingFile] = useState(null);

  useEffect(() => {
    loadBackups();
  }, [tenantId]);

  const loadBackups = async () => {
    setLoading(true);
    try {
      const backupsKey = `backups_${tenantId}`;
      const stored = localStorage.getItem(backupsKey);
      setBackups(stored ? JSON.parse(stored) : []);
    } catch (error) {
      console.error('Failed to load backups:', error);
    }
    setLoading(false);
  };

  const createBackup = async () => {
    setCreating(true);
    try {
      // Fetch all workspace data
      const [orders, orderLines, skus, stores, purchases, currentStock, suppliers, stockMovements, importBatches, tasks] = await Promise.all([
        base44.entities.Order.filter({ tenant_id: tenantId }),
        base44.entities.OrderLine.filter({ tenant_id: tenantId }),
        base44.entities.SKU.filter({ tenant_id: tenantId }),
        base44.entities.Store.filter({ tenant_id: tenantId }),
        base44.entities.Purchase.filter({ tenant_id: tenantId }),
        base44.entities.CurrentStock.filter({ tenant_id: tenantId }),
        base44.entities.Supplier.filter({ tenant_id: tenantId }),
        base44.entities.StockMovement.filter({ tenant_id: tenantId }),
        base44.entities.ImportBatch.filter({ tenant_id: tenantId }),
        base44.entities.Task.filter({ tenant_id: tenantId })
      ]);

      const timestamp = new Date().toISOString();
      const backup = {
        id: `backup_${Date.now()}`,
        name: backupName || `Backup ${format(new Date(), 'MMM d, yyyy h:mm a')}`,
        timestamp,
        data: {
          orders,
          orderLines,
          skus,
          stores,
          purchases,
          currentStock,
          suppliers,
          stockMovements,
          importBatches,
          tasks
        },
        stats: {
          orders: orders.length,
          skus: skus.length,
          purchases: purchases.length
        }
      };

      // Store in localStorage
      const backupsKey = `backups_${tenantId}`;
      const existing = localStorage.getItem(backupsKey);
      const allBackups = existing ? JSON.parse(existing) : [];
      allBackups.unshift(backup);
      localStorage.setItem(backupsKey, JSON.stringify(allBackups));

      setBackups(allBackups);
      setShowCreateDialog(false);
      setBackupName('');
      toast({ title: '✓ Backup created successfully' });
    } catch (error) {
      toast({ 
        title: 'Backup failed', 
        description: error.message, 
        variant: 'destructive' 
      });
    }
    setCreating(false);
  };

  const downloadBackup = (backup) => {
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_${backup.name.replace(/\s+/g, '_')}_${format(new Date(backup.timestamp), 'yyyyMMdd')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const restoreBackup = async (backup) => {
    setRestoring(true);
    try {
      // Delete all existing workspace data
      const [orders, orderLines, skus, stores, purchases, currentStock, suppliers, stockMovements, importBatches, tasks] = await Promise.all([
        base44.entities.Order.filter({ tenant_id: tenantId }),
        base44.entities.OrderLine.filter({ tenant_id: tenantId }),
        base44.entities.SKU.filter({ tenant_id: tenantId }),
        base44.entities.Store.filter({ tenant_id: tenantId }),
        base44.entities.Purchase.filter({ tenant_id: tenantId }),
        base44.entities.CurrentStock.filter({ tenant_id: tenantId }),
        base44.entities.Supplier.filter({ tenant_id: tenantId }),
        base44.entities.StockMovement.filter({ tenant_id: tenantId }),
        base44.entities.ImportBatch.filter({ tenant_id: tenantId }),
        base44.entities.Task.filter({ tenant_id: tenantId })
      ]);

      // Delete in correct order (dependencies first)
      for (const item of orderLines) await base44.entities.OrderLine.delete(item.id);
      for (const item of orders) await base44.entities.Order.delete(item.id);
      for (const item of currentStock) await base44.entities.CurrentStock.delete(item.id);
      for (const item of purchases) await base44.entities.Purchase.delete(item.id);
      for (const item of skus) await base44.entities.SKU.delete(item.id);
      for (const item of stockMovements) await base44.entities.StockMovement.delete(item.id);
      for (const item of suppliers) await base44.entities.Supplier.delete(item.id);
      for (const item of stores) await base44.entities.Store.delete(item.id);
      for (const item of importBatches) await base44.entities.ImportBatch.delete(item.id);
      for (const item of tasks) await base44.entities.Task.delete(item.id);

      // Restore from backup (in correct order)
      if (backup.data.suppliers?.length) await base44.entities.Supplier.bulkCreate(backup.data.suppliers.map(({ id, created_date, updated_date, created_by, ...rest }) => rest));
      if (backup.data.stores?.length) await base44.entities.Store.bulkCreate(backup.data.stores.map(({ id, created_date, updated_date, created_by, ...rest }) => rest));
      if (backup.data.skus?.length) await base44.entities.SKU.bulkCreate(backup.data.skus.map(({ id, created_date, updated_date, created_by, ...rest }) => rest));
      if (backup.data.importBatches?.length) await base44.entities.ImportBatch.bulkCreate(backup.data.importBatches.map(({ id, created_date, updated_date, created_by, ...rest }) => rest));
      if (backup.data.orders?.length) await base44.entities.Order.bulkCreate(backup.data.orders.map(({ id, created_date, updated_date, created_by, ...rest }) => rest));
      if (backup.data.orderLines?.length) await base44.entities.OrderLine.bulkCreate(backup.data.orderLines.map(({ id, created_date, updated_date, created_by, ...rest }) => rest));
      if (backup.data.purchases?.length) await base44.entities.Purchase.bulkCreate(backup.data.purchases.map(({ id, created_date, updated_date, created_by, ...rest }) => rest));
      if (backup.data.currentStock?.length) await base44.entities.CurrentStock.bulkCreate(backup.data.currentStock.map(({ id, created_date, updated_date, created_by, ...rest }) => rest));
      if (backup.data.stockMovements?.length) await base44.entities.StockMovement.bulkCreate(backup.data.stockMovements.map(({ id, created_date, updated_date, created_by, ...rest }) => rest));
      if (backup.data.tasks?.length) await base44.entities.Task.bulkCreate(backup.data.tasks.map(({ id, created_date, updated_date, created_by, ...rest }) => rest));

      setShowRestoreDialog(false);
      setSelectedBackup(null);
      toast({ 
        title: '✓ Restore complete', 
        description: 'Workspace restored from backup. Refreshing...' 
      });
      
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      toast({ 
        title: 'Restore failed', 
        description: error.message, 
        variant: 'destructive' 
      });
    }
    setRestoring(false);
  };

  const deleteBackup = (backupId) => {
    const backupsKey = `backups_${tenantId}`;
    const filtered = backups.filter(b => b.id !== backupId);
    localStorage.setItem(backupsKey, JSON.stringify(filtered));
    setBackups(filtered);
    toast({ title: 'Backup deleted' });
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/json') {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const backup = JSON.parse(event.target.result);
          if (!backup.data || !backup.timestamp) {
            throw new Error('Invalid backup file format');
          }
          setSelectedBackup(backup);
          setShowRestoreDialog(true);
        } catch (error) {
          toast({ 
            title: 'Invalid file', 
            description: 'Please upload a valid backup JSON file', 
            variant: 'destructive' 
          });
        }
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Backup & Restore</h2>
          <p className="text-sm text-slate-500">Create manual backups of your workspace data</p>
        </div>
        <div className="flex gap-2">
          <label htmlFor="upload-backup">
            <Button variant="outline" className="cursor-pointer" asChild>
              <span>
                <Upload className="w-4 h-4 mr-2" />
                Upload Backup
              </span>
            </Button>
            <input
              id="upload-backup"
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
          <Button 
            onClick={() => setShowCreateDialog(true)}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            <Database className="w-4 h-4 mr-2" />
            Create Backup
          </Button>
        </div>
      </div>

      {/* Backups List */}
      {backups.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-xl border border-slate-200">
          <Database className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600">No backups yet</p>
          <p className="text-sm text-slate-500">Create your first backup to secure your data</p>
        </div>
      ) : (
        <div className="space-y-3">
          {backups.map(backup => (
            <div key={backup.id} className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:bg-slate-50">
              <div className="flex-1">
                <h3 className="font-semibold text-slate-900">{backup.name}</h3>
                <p className="text-sm text-slate-500">
                  {format(new Date(backup.timestamp), 'MMM d, yyyy h:mm a')} • 
                  {backup.stats.orders} orders • {backup.stats.skus} SKUs • {backup.stats.purchases} purchases
                </p>
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => downloadBackup(backup)}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    setSelectedBackup(backup);
                    setShowRestoreDialog(true);
                  }}
                  className="text-indigo-600 hover:text-indigo-700"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Restore
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => deleteBackup(backup.id)}
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Backup Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Workspace Backup</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm text-blue-800">
                This will create a snapshot of all your workspace data including orders, SKUs, purchases, stock levels, and more.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Backup Name (Optional)</Label>
              <Input
                value={backupName}
                onChange={(e) => setBackupName(e.target.value)}
                placeholder="e.g., End of Month Backup"
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                Cancel
              </Button>
              <Button 
                onClick={createBackup} 
                disabled={creating}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {creating ? 'Creating...' : 'Create Backup'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Restore Confirmation Dialog */}
      <AlertDialog open={showRestoreDialog} onOpenChange={setShowRestoreDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore Workspace from Backup?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-red-900 mb-2">Warning: This action is IRREVERSIBLE</p>
                      <ul className="text-xs text-red-800 space-y-1 list-disc list-inside">
                        <li>All current workspace data will be deleted</li>
                        <li>Data will be replaced with backup snapshot</li>
                        <li>Any changes made after {selectedBackup && format(new Date(selectedBackup.timestamp), 'MMM d, yyyy h:mm a')} will be lost</li>
                      </ul>
                    </div>
                  </div>
                </div>
                <p className="text-sm text-slate-600">
                  Restoring: <strong>{selectedBackup?.name}</strong>
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowRestoreDialog(false);
              setSelectedBackup(null);
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => restoreBackup(selectedBackup)}
              className="bg-red-600 hover:bg-red-700"
              disabled={restoring}
            >
              {restoring ? 'Restoring...' : 'Confirm Restore'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}