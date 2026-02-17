import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Database, Download, Upload, Trash2, AlertTriangle, CheckCircle, Shield } from 'lucide-react';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { format } from 'date-fns';
import { useTenant } from '@/components/hooks/useTenant';

export default function BackupManager({ tenantId }) {
  const { toast } = useToast();
  const { tenant, user } = useTenant();
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [backupName, setBackupName] = useState('');
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState(null);
  const [uploadingFile, setUploadingFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStep, setUploadStep] = useState('');
  const [showUploadProgress, setShowUploadProgress] = useState(false);
  const [jobPolling, setJobPolling] = useState(null);
  const [allJobs, setAllJobs] = useState([]);
  const [jobToDelete, setJobToDelete] = useState(null);
  const [restoreFromPrevious, setRestoreFromPrevious] = useState(false);
  const [confirmationText, setConfirmationText] = useState('');
  const [restoreProgress, setRestoreProgress] = useState({ current: 0, total: 0, step: '' });

  useEffect(() => {
    loadBackups();
    loadJobHistory();
  }, [tenantId]);

  const loadJobHistory = async () => {
    try {
      const jobs = await base44.entities.BackupJob.filter({ tenant_id: tenantId });
      setAllJobs(jobs.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)));
    } catch (error) {
      console.error('Failed to load job history:', error);
    }
  };

  useEffect(() => {
    if (!jobPolling) return;

    const interval = setInterval(async () => {
      try {
        const currentJob = await base44.entities.BackupJob.get(jobPolling.jobId);
        if (!currentJob) return;
        
        if (currentJob.status === 'completed') {
          setBackups(prev => [{
            id: currentJob.id,
            name: currentJob.backup_name,
            timestamp: currentJob.started_at,
            data: currentJob.backup_data ? JSON.parse(currentJob.backup_data) : null,
            file_url: currentJob.file_url,
            file_size_bytes: currentJob.file_size_bytes,
            stats: currentJob.stats,
            serverBackup: true
          }, ...prev]);
          
          toast({ 
            title: '✓ Backup completed', 
            description: `${(currentJob.file_size_bytes / 1024 / 1024).toFixed(2)} MB saved` 
          });
          setCreating(false);
          setJobPolling(null);
          setShowCreateDialog(false);
          setBackupName('');
          loadJobHistory();
        } else if (currentJob.status === 'failed') {
          toast({ 
            title: 'Backup failed', 
            description: currentJob.error_message, 
            variant: 'destructive' 
          });
          setCreating(false);
          setJobPolling(null);
        }
      } catch (error) {
        console.error('Job polling error:', error);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [jobPolling]);

  const loadBackups = async () => {
    setLoading(true);
    try {
      // Load server-side backups
      const serverBackups = await base44.entities.BackupJob.filter({ 
        tenant_id: tenantId,
        status: 'completed'
      });
      
      const formatted = serverBackups.map(job => ({
        id: job.id,
        name: job.backup_name,
        timestamp: job.started_at,
        data: job.backup_data ? JSON.parse(job.backup_data) : null,
        file_url: job.file_url,
        file_size_bytes: job.file_size_bytes,
        stats: job.stats || {},
        source_workspace_id: job.source_workspace_id,
        source_workspace_name: job.source_workspace_name,
        serverBackup: true
      }));

      // Also load legacy localStorage backups (read-only)
      const backupsKey = `backups_${tenantId}`;
      const stored = localStorage.getItem(backupsKey);
      const legacyBackups = stored ? JSON.parse(stored) : [];

      setBackups([...formatted, ...legacyBackups]);
    } catch (error) {
      console.error('Failed to load backups:', error);
      // Fallback to localStorage only
      try {
        const backupsKey = `backups_${tenantId}`;
        const stored = localStorage.getItem(backupsKey);
        setBackups(stored ? JSON.parse(stored) : []);
      } catch (fallbackError) {
        console.error('Fallback load failed:', fallbackError);
      }
    }
    setLoading(false);
  };

  const createBackup = async () => {
    setCreating(true);
    try {
      // Create backup job on server
      const response = await base44.functions.invoke('createBackupJob', {
        tenantId,
        backupName: backupName || `Backup ${format(new Date(), 'MMM d, yyyy h:mm a')}`
      });

      const jobId = response.data.jobId;
      setJobPolling({ jobId });

      // Immediately trigger async execution
      base44.functions.invoke('executeBackupJob', { 
        jobId, 
        tenantId 
      }).catch(err => {
        console.error('Async backup execution failed:', err);
        toast({ 
          title: 'Backup processing error', 
          description: err.message, 
          variant: 'destructive' 
        });
      });

      toast({ 
        title: 'Backup in progress...', 
        description: 'Creating backup. This may take a moment.' 
      });
    } catch (error) {
      toast({ 
        title: 'Backup failed', 
        description: error.message, 
        variant: 'destructive' 
      });
      setCreating(false);
    }
  };

  const downloadBackup = (backup) => {
    // Server backup: download backup data
    if (backup.serverBackup && backup.data) {
      const json = JSON.stringify(backup.data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_${backup.name.replace(/\s+/g, '_')}_${format(new Date(backup.timestamp), 'yyyyMMdd')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    // Legacy localStorage backup: download as JSON
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
    setRestoreProgress({ current: 0, total: 100, step: 'Preparing restore...' });
    const startTime = new Date().toISOString();
    
    try {
      let backupData = backup.data;
      
      // Extract source workspace info (handle uploaded backups without metadata)
      const sourceWorkspaceId = backup.source_workspace_id || 
        (backupData?.stores?.[0]?.tenant_id) || 
        (backupData?.skus?.[0]?.tenant_id) ||
        'unknown';
      const sourceWorkspaceName = backup.source_workspace_name || 'Uploaded Backup';
      
      setRestoreProgress({ current: 5, total: 100, step: 'Creating restore log...' });
      
      // Create restore log
      const restoreLog = await base44.entities.RestoreLog.create({
        backup_job_id: backup.id || 'uploaded',
        source_workspace_id: sourceWorkspaceId,
        source_workspace_name: sourceWorkspaceName,
        target_workspace_id: tenantId,
        target_workspace_name: tenant?.name || 'Current Workspace',
        status: 'in_progress',
        restored_by: user?.email,
        started_at: startTime
      });

      setRestoreProgress({ current: 10, total: 100, step: 'Loading existing data...' });

      // Count existing data BEFORE purge
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

      const countsBefore = {
        orders: orders.length,
        orderLines: orderLines.length,
        skus: skus.length,
        stores: stores.length,
        purchases: purchases.length,
        currentStock: currentStock.length,
        suppliers: suppliers.length,
        stockMovements: stockMovements.length,
        importBatches: importBatches.length,
        tasks: tasks.length
      };

      const totalToDelete = countsBefore.orders + countsBefore.orderLines + countsBefore.skus + 
        countsBefore.stores + countsBefore.purchases + countsBefore.currentStock +
        countsBefore.suppliers + countsBefore.stockMovements + countsBefore.importBatches + countsBefore.tasks;

      setRestoreProgress({ current: 20, total: 100, step: `Deleting ${totalToDelete} existing records...` });

      // PURGE: Delete all existing target workspace data (dependencies first)
      let deleted = 0;
      for (const item of orderLines) {
        await base44.entities.OrderLine.delete(item.id);
        deleted++;
        if (deleted % 50 === 0) setRestoreProgress({ current: 20 + (deleted / totalToDelete) * 20, total: 100, step: `Deleting... ${deleted}/${totalToDelete}` });
      }
      for (const item of orders) {
        await base44.entities.Order.delete(item.id);
        deleted++;
        if (deleted % 50 === 0) setRestoreProgress({ current: 20 + (deleted / totalToDelete) * 20, total: 100, step: `Deleting... ${deleted}/${totalToDelete}` });
      }
      for (const item of currentStock) await base44.entities.CurrentStock.delete(item.id);
      for (const item of purchases) await base44.entities.Purchase.delete(item.id);
      for (const item of skus) await base44.entities.SKU.delete(item.id);
      for (const item of stockMovements) await base44.entities.StockMovement.delete(item.id);
      for (const item of suppliers) await base44.entities.Supplier.delete(item.id);
      for (const item of stores) await base44.entities.Store.delete(item.id);
      for (const item of importBatches) await base44.entities.ImportBatch.delete(item.id);
      for (const item of tasks) await base44.entities.Task.delete(item.id);

      setRestoreProgress({ current: 45, total: 100, step: 'Restoring backup data...' });

      // IMPORT: Restore backup data into TARGET workspace (force tenant_id = current workspace)
      const stripBuiltins = (items) => items.map(({ id, created_date, updated_date, created_by, tenant_id, ...rest }) => ({ ...rest, tenant_id: tenantId }));

      const totalToRestore = (backupData.suppliers?.length || 0) + (backupData.stores?.length || 0) +
        (backupData.skus?.length || 0) + (backupData.orders?.length || 0) + 
        (backupData.orderLines?.length || 0) + (backupData.purchases?.length || 0) +
        (backupData.currentStock?.length || 0) + (backupData.tasks?.length || 0);

      let restored = 0;
      const updateRestoreProgress = (count) => {
        restored += count;
        setRestoreProgress({ 
          current: 45 + (restored / totalToRestore) * 50, 
          total: 100, 
          step: `Restoring... ${restored}/${totalToRestore}` 
        });
      };

      if (backupData.suppliers?.length) {
        await base44.entities.Supplier.bulkCreate(stripBuiltins(backupData.suppliers));
        updateRestoreProgress(backupData.suppliers.length);
      }
      if (backupData.stores?.length) {
        await base44.entities.Store.bulkCreate(stripBuiltins(backupData.stores));
        updateRestoreProgress(backupData.stores.length);
      }
      if (backupData.skus?.length) {
        await base44.entities.SKU.bulkCreate(stripBuiltins(backupData.skus));
        updateRestoreProgress(backupData.skus.length);
      }
      if (backupData.importBatches?.length) await base44.entities.ImportBatch.bulkCreate(stripBuiltins(backupData.importBatches));
      if (backupData.orders?.length) {
        await base44.entities.Order.bulkCreate(stripBuiltins(backupData.orders));
        updateRestoreProgress(backupData.orders.length);
      }
      if (backupData.orderLines?.length) {
        await base44.entities.OrderLine.bulkCreate(stripBuiltins(backupData.orderLines));
        updateRestoreProgress(backupData.orderLines.length);
      }
      if (backupData.purchases?.length) {
        await base44.entities.Purchase.bulkCreate(stripBuiltins(backupData.purchases));
        updateRestoreProgress(backupData.purchases.length);
      }
      if (backupData.currentStock?.length) {
        await base44.entities.CurrentStock.bulkCreate(stripBuiltins(backupData.currentStock));
        updateRestoreProgress(backupData.currentStock.length);
      }
      if (backupData.stockMovements?.length) await base44.entities.StockMovement.bulkCreate(stripBuiltins(backupData.stockMovements));
      if (backupData.tasks?.length) {
        await base44.entities.Task.bulkCreate(stripBuiltins(backupData.tasks));
        updateRestoreProgress(backupData.tasks.length);
      }
      if (backupData.checklistItems?.length) await base44.entities.TaskChecklistItem.bulkCreate(stripBuiltins(backupData.checklistItems));
      if (backupData.comments?.length) await base44.entities.TaskComment.bulkCreate(stripBuiltins(backupData.comments));
      if (backupData.returns?.length) await base44.entities.Return.bulkCreate(stripBuiltins(backupData.returns));

      setRestoreProgress({ current: 98, total: 100, step: 'Finalizing...' });

      // Count AFTER restore
      const countsAfter = {
        orders: backupData.orders?.length || 0,
        orderLines: backupData.orderLines?.length || 0,
        skus: backupData.skus?.length || 0,
        stores: backupData.stores?.length || 0,
        purchases: backupData.purchases?.length || 0,
        currentStock: backupData.currentStock?.length || 0,
        suppliers: backupData.suppliers?.length || 0,
        stockMovements: backupData.stockMovements?.length || 0,
        importBatches: backupData.importBatches?.length || 0,
        tasks: backupData.tasks?.length || 0
      };

      // Update restore log
      await base44.entities.RestoreLog.update(restoreLog.id, {
        status: 'completed',
        counts_before_purge: countsBefore,
        counts_after_restore: countsAfter,
        validation_results: { success: true },
        completed_at: new Date().toISOString()
      });

      setRestoreProgress({ current: 100, total: 100, step: 'Complete!' });

      setTimeout(() => {
        setShowRestoreDialog(false);
        setSelectedBackup(null);
        setConfirmationText('');
        setRestoreProgress({ current: 0, total: 0, step: '' });
        toast({ 
          title: '✓ Restore complete', 
          description: `${countsAfter.orders} orders, ${countsAfter.skus} SKUs restored. Refreshing...` 
        });
        
        setTimeout(() => window.location.reload(), 1500);
      }, 500);
    } catch (error) {
      setRestoreProgress({ current: 0, total: 0, step: '' });
      toast({ 
        title: 'Restore failed', 
        description: error.message, 
        variant: 'destructive' 
      });
      setRestoring(false);
    }
  };

  const deleteBackup = (backupId) => {
    // Remove from UI state
    const filtered = backups.filter(b => b.id !== backupId);
    setBackups(filtered);
    
    // If server backup, no deletion needed (immutable in Base44)
    const backup = backups.find(b => b.id === backupId);
    if (!backup?.serverBackup) {
      // Only delete legacy localStorage backups
      const backupsKey = `backups_${tenantId}`;
      const remaining = filtered.filter(b => !b.serverBackup);
      if (remaining.length === 0) {
        localStorage.removeItem(backupsKey);
      } else {
        localStorage.setItem(backupsKey, JSON.stringify(remaining));
      }
    }
    
    toast({ title: 'Backup removed from list' });
  };

  const deleteBackupJob = async (jobId) => {
    try {
      // Get previous backup if restore is requested
      let previousBackup = null;
      if (restoreFromPrevious && allJobs.length > 1) {
        const deletedIndex = allJobs.findIndex(j => j.id === jobId);
        if (deletedIndex >= 0 && deletedIndex < allJobs.length - 1) {
          previousBackup = allJobs[deletedIndex + 1];
        }
      }

      // Delete the backup job
      await base44.entities.BackupJob.delete(jobId);
      setAllJobs(prev => prev.filter(j => j.id !== jobId));
      
      // If restoring from previous backup
      if (restoreFromPrevious && previousBackup?.backup_data) {
        const backupData = JSON.parse(previousBackup.backup_data);
        await restoreBackup({ 
          data: backupData, 
          timestamp: previousBackup.started_at 
        });
        return;
      }
      
      setJobToDelete(null);
      setRestoreFromPrevious(false);
      toast({ title: 'Backup deleted' });
    } catch (error) {
      toast({ 
        title: 'Failed to delete backup', 
        description: error.message, 
        variant: 'destructive' 
      });
    }
  };

  const cleanupLegacyBackups = async () => {
    const backupsKey = `backups_${tenantId}`;
    const stored = localStorage.getItem(backupsKey);
    if (!stored) return;

    try {
      const allBackups = JSON.parse(stored);
      // Filter to keep only small backups (< 1MB serialized)
      const safe = allBackups.filter(b => {
        const size = JSON.stringify(b).length;
        return size < 1024 * 1024;
      });

      if (safe.length < allBackups.length) {
        if (safe.length === 0) {
          localStorage.removeItem(backupsKey);
        } else {
          localStorage.setItem(backupsKey, JSON.stringify(safe));
        }
      }
    } catch (error) {
      console.error('Legacy cleanup failed:', error);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file || file.type !== 'application/json') {
      toast({ 
        title: 'Invalid file type', 
        description: 'Please upload a .json backup file', 
        variant: 'destructive' 
      });
      return;
    }

    setUploadingFile(file.name);
    setUploadProgress(0);
    setUploadStep('Reading file...');
    setShowUploadProgress(true);

    const reader = new FileReader();
    
    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.floor((event.loaded / event.total) * 80);
        setUploadProgress(percentComplete);
      }
    };

    reader.onload = (event) => {
      try {
        setUploadStep('Parsing backup data...');
        setUploadProgress(85);
        
        setTimeout(() => {
          const backup = JSON.parse(event.target.result);
          if (!backup.data || !backup.timestamp) {
            throw new Error('Invalid backup file format');
          }
          
          setUploadStep('Validating backup...');
          setUploadProgress(95);
          
          setTimeout(() => {
            setUploadProgress(100);
            setUploadStep('Ready to restore');
            
            setTimeout(() => {
              setSelectedBackup(backup);
              setUploadingFile(null);
              setUploadProgress(0);
              setUploadStep('');
              setShowUploadProgress(false);
              setShowRestoreDialog(true);
            }, 500);
          }, 300);
        }, 200);
      } catch (error) {
        setUploadingFile(null);
        setUploadProgress(0);
        setUploadStep('');
        setShowUploadProgress(false);
        toast({ 
          title: 'Invalid file', 
          description: 'Please upload a valid backup JSON file', 
          variant: 'destructive' 
        });
      }
    };

    reader.onerror = () => {
      setUploadingFile(null);
      setUploadProgress(0);
      setUploadStep('');
      setShowUploadProgress(false);
      toast({ 
        title: 'File read error', 
        description: 'Failed to read the backup file', 
        variant: 'destructive' 
      });
    };

    reader.readAsText(file);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Backup & Restore</h2>
          <p className="text-sm text-slate-500">Create and restore workspace data backups</p>
        </div>
        <div className="flex gap-2">
          <label htmlFor="upload-backup">
            <Button variant="outline" className="cursor-pointer" asChild disabled={uploadingFile !== null}>
              <span>
                {uploadingFile ? (
                  <>
                    <div className="w-4 h-4 mr-2 border-2 border-slate-300 border-t-indigo-600 rounded-full animate-spin" />
                    {uploadProgress}%
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload Backup
                  </>
                )}
              </span>
            </Button>
            <input
              id="upload-backup"
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="hidden"
              disabled={uploadingFile !== null}
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

      {/* Backup Job History */}
      <div className="mt-8 pt-6 border-t">
        <h3 className="font-semibold text-slate-900 mb-4">Backup History</h3>
        {allJobs.length === 0 ? (
          <p className="text-sm text-slate-500">No backup jobs yet</p>
        ) : (
          <div className="space-y-2">
            {allJobs.map((job, idx) => (
              <div key={job.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-slate-900">{job.backup_name}</p>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      job.status === 'completed' ? 'bg-green-100 text-green-800' :
                      job.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                      job.status === 'queued' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Started: {format(new Date(job.started_at), 'MMM d, yyyy h:mm a')}
                    {job.completed_at && ` • Completed: ${format(new Date(job.completed_at), 'h:mm a')}`}
                    {job.file_size_bytes && ` • Size: ${(job.file_size_bytes / 1024 / 1024).toFixed(2)} MB`}
                  </p>
                  {job.stats && (
                    <p className="text-xs text-slate-500 mt-1">
                      Orders: {job.stats.orders}, SKUs: {job.stats.skus}, Purchases: {job.stats.purchases}
                    </p>
                  )}
                  {job.error_message && (
                    <p className="text-xs text-red-600 mt-1">Error: {job.error_message}</p>
                  )}
                </div>
                {job.status === 'completed' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setJobToDelete(job)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
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
               <div className="flex items-center gap-2">
                 <h3 className="font-semibold text-slate-900">{backup.name}</h3>
                 {backup.serverBackup && <span className="text-xs bg-indigo-100 text-indigo-800 px-2 py-1 rounded">Server</span>}
                 {backup.source_workspace_id === tenantId && (
                   <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">This Workspace</span>
                 )}
               </div>
               <p className="text-sm text-slate-500">
                 {format(new Date(backup.timestamp), 'MMM d, yyyy h:mm a')} • 
                 Source: {backup.source_workspace_name || 'Unknown'} • 
                 {backup.stats?.stores || 0} stores • {backup.stats?.skus || 0} SKUs • {backup.stats?.orders || 0} orders • {backup.stats?.purchases || 0} purchases
               </p>
               <p className="text-xs text-slate-400 mt-1">
                 {backup.stats && Object.entries(backup.stats).map(([k, v]) => v > 0 && `${k}(${v})`).filter(Boolean).join(' • ')}
                 {backup.file_size_bytes && <> • {(backup.file_size_bytes / 1024 / 1024).toFixed(2)} MB</>}
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

      {/* Delete Backup Dialog */}
      <AlertDialog open={!!jobToDelete} onOpenChange={() => setJobToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Backup?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-slate-600 mb-2">
                    You are about to delete backup: <strong>{jobToDelete?.backup_name}</strong>
                  </p>
                  {allJobs.length > 1 && (
                    <div className="flex items-center gap-2 mt-4">
                      <input
                        type="checkbox"
                        id="restore-prev"
                        checked={restoreFromPrevious}
                        onChange={(e) => setRestoreFromPrevious(e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      <label htmlFor="restore-prev" className="text-sm cursor-pointer">
                        Restore workspace from previous backup version
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => deleteBackupJob(jobToDelete?.id)}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete{restoreFromPrevious ? ' & Restore' : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Upload Progress Modal */}
      <Dialog open={showUploadProgress} onOpenChange={setShowUploadProgress}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Uploading Backup</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">{uploadStep}</span>
                <span className="font-medium">{uploadProgress}%</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2">
                <div 
                  className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
            {uploadingFile && (
              <p className="text-sm text-slate-500">File: {uploadingFile}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Restore Confirmation Dialog */}
      <AlertDialog open={showRestoreDialog} onOpenChange={setShowRestoreDialog}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-red-600" />
              Restore Workspace from Backup?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                {/* Source/Target Info */}
                <Alert className="border-indigo-200 bg-indigo-50">
                  <AlertDescription>
                    <div className="space-y-2 text-sm">
                      <div>
                        <strong>Source Workspace:</strong> {selectedBackup?.source_workspace_name || 'Unknown'}
                      </div>
                      <div>
                        <strong>Target Workspace (Current):</strong> {tenant?.name}
                      </div>
                      <div>
                        <strong>Backup Created:</strong> {selectedBackup && format(new Date(selectedBackup.timestamp), 'MMM d, yyyy h:mm a')}
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>

                {/* Warning */}
                <Alert className="border-red-200 bg-red-50">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                  <AlertDescription>
                    <div>
                      <p className="text-sm font-semibold text-red-900 mb-2">⚠️ IRREVERSIBLE OPERATION</p>
                      <ul className="text-xs text-red-800 space-y-1 list-disc list-inside">
                        <li>All data in <strong>{tenant?.name}</strong> will be DELETED</li>
                        <li>Target workspace will be replaced with backup data from <strong>{selectedBackup?.source_workspace_name}</strong></li>
                        <li>No undo or merge - this is a complete replacement</li>
                      </ul>
                    </div>
                  </AlertDescription>
                </Alert>

                {/* Confirmation Input */}
                {selectedBackup?.source_workspace_id !== tenantId && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      Type the target workspace name to confirm: <span className="text-red-600">{tenant?.name}</span>
                    </Label>
                    <Input
                      value={confirmationText}
                      onChange={(e) => setConfirmationText(e.target.value)}
                      placeholder="Type workspace name"
                      className="font-mono"
                    />
                  </div>
                )}

                <p className="text-xs text-slate-600">
                  Restoring: <strong>{selectedBackup?.name}</strong> ({selectedBackup?.stats?.orders || 0} orders, {selectedBackup?.stats?.skus || 0} SKUs, {selectedBackup?.stats?.purchases || 0} purchases)
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowRestoreDialog(false);
              setSelectedBackup(null);
              setConfirmationText('');
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => restoreBackup(selectedBackup)}
              className="bg-red-600 hover:bg-red-700"
              disabled={
                restoring || 
                (selectedBackup?.source_workspace_id !== tenantId && confirmationText !== tenant?.name)
              }
            >
              {restoring ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>{restoreProgress.step || 'Restoring...'}</span>
                </div>
              ) : 'Confirm Replace All Data'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}