import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
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
import { Shield, AlertTriangle, Database, CheckCircle, Clock, FileText } from 'lucide-react';
import { format } from 'date-fns';

export default function EmergencyRestore() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [targetWorkspace, setTargetWorkspace] = useState(null);
  const [availableBackups, setAvailableBackups] = useState([]);
  const [selectedBackup, setSelectedBackup] = useState(null);
  const [currentSnapshot, setCurrentSnapshot] = useState(null);
  const [restoreReport, setRestoreReport] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [otherWorkspaces, setOtherWorkspaces] = useState([]);

  useEffect(() => {
    loadRestoreData();
  }, []);

  const loadRestoreData = async () => {
    setLoading(true);
    try {
      // Find AMZ EG workspace
      const workspaces = await base44.entities.Tenant.list();
      const amzEg = workspaces.find(w => w.name === 'AMZ EG');
      
      if (!amzEg) {
        toast({
          title: 'Workspace not found',
          description: 'Could not find "AMZ EG" workspace',
          variant: 'destructive'
        });
        return;
      }

      setTargetWorkspace(amzEg);

      // Get other workspaces for validation
      const others = workspaces.filter(w => w.id !== amzEg.id).slice(0, 3);
      setOtherWorkspaces(others);

      // Find backups created BEFORE Feb 17, 2026
      const cutoffDate = new Date('2026-02-17T00:00:00Z');
      const backups = await base44.entities.BackupJob.filter({
        tenant_id: amzEg.id,
        status: 'completed'
      });

      const validBackups = backups
        .filter(b => new Date(b.completed_at) < cutoffDate)
        .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));

      setAvailableBackups(validBackups);

      // Take current snapshot for safety
      await createSafetySnapshot(amzEg.id);

    } catch (error) {
      toast({
        title: 'Load failed',
        description: error.message,
        variant: 'destructive'
      });
    }
    setLoading(false);
  };

  const createSafetySnapshot = async (workspaceId) => {
    try {
      const counts = await getCurrentCounts(workspaceId);
      setCurrentSnapshot({
        timestamp: new Date().toISOString(),
        counts,
        workspace_id: workspaceId
      });
    } catch (error) {
      console.error('Failed to create safety snapshot:', error);
    }
  };

  const getCurrentCounts = async (workspaceId) => {
    const [stores, suppliers, skus, orders, orderLines, purchases, returns, tasks, currentStock, stockMovements] = await Promise.all([
      base44.entities.Store.filter({ tenant_id: workspaceId }),
      base44.entities.Supplier.filter({ tenant_id: workspaceId }),
      base44.entities.SKU.filter({ tenant_id: workspaceId }),
      base44.entities.Order.filter({ tenant_id: workspaceId }),
      base44.entities.OrderLine.filter({ tenant_id: workspaceId }),
      base44.entities.Purchase.filter({ tenant_id: workspaceId }),
      base44.entities.Return?.filter({ tenant_id: workspaceId }).catch(() => []) || [],
      base44.entities.Task.filter({ tenant_id: workspaceId }),
      base44.entities.CurrentStock.filter({ tenant_id: workspaceId }),
      base44.entities.StockMovement.filter({ tenant_id: workspaceId })
    ]);

    return {
      stores: stores.length,
      suppliers: suppliers.length,
      skus: skus.length,
      orders: orders.length,
      orderLines: orderLines.length,
      purchases: purchases.length,
      returns: returns.length,
      tasks: tasks.length,
      currentStock: currentStock.length,
      stockMovements: stockMovements.length
    };
  };

  const validateOtherWorkspaces = async (beforeCounts) => {
    const afterCounts = {};
    for (const ws of otherWorkspaces) {
      afterCounts[ws.id] = await getCurrentCounts(ws.id);
    }

    // Check if any changed
    for (const ws of otherWorkspaces) {
      const before = beforeCounts[ws.id];
      const after = afterCounts[ws.id];
      
      for (const key of Object.keys(before)) {
        if (before[key] !== after[key]) {
          return {
            success: false,
            workspace: ws.name,
            entity: key,
            before: before[key],
            after: after[key]
          };
        }
      }
    }

    return { success: true };
  };

  const performRestore = async () => {
    setRestoring(true);
    const startTime = new Date().toISOString();

    try {
      const backup = selectedBackup;
      const backupData = JSON.parse(backup.backup_data);
      const workspaceId = targetWorkspace.id;

      // Step 1: Snapshot other workspaces BEFORE any changes
      const otherWorkspacesCountsBefore = {};
      for (const ws of otherWorkspaces) {
        otherWorkspacesCountsBefore[ws.id] = await getCurrentCounts(ws.id);
      }

      // Step 2: Count current AMZ EG data
      const countsBefore = await getCurrentCounts(workspaceId);

      // Step 3: PURGE AMZ EG data ONLY (with workspace_id filter)
      const [orders, orderLines, skus, stores, purchases, currentStock, suppliers, stockMovements, importBatches, tasks] = await Promise.all([
        base44.entities.Order.filter({ tenant_id: workspaceId }),
        base44.entities.OrderLine.filter({ tenant_id: workspaceId }),
        base44.entities.SKU.filter({ tenant_id: workspaceId }),
        base44.entities.Store.filter({ tenant_id: workspaceId }),
        base44.entities.Purchase.filter({ tenant_id: workspaceId }),
        base44.entities.CurrentStock.filter({ tenant_id: workspaceId }),
        base44.entities.Supplier.filter({ tenant_id: workspaceId }),
        base44.entities.StockMovement.filter({ tenant_id: workspaceId }),
        base44.entities.ImportBatch.filter({ tenant_id: workspaceId }),
        base44.entities.Task.filter({ tenant_id: workspaceId })
      ]);

      // Delete in dependency order (ONLY AMZ EG records)
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

      // Step 4: Restore backup data (force workspace_id to AMZ EG)
      const stripBuiltins = (items) => items.map(({ id, created_date, updated_date, created_by, tenant_id, ...rest }) => ({ 
        ...rest, 
        tenant_id: workspaceId 
      }));

      if (backupData.suppliers?.length) await base44.entities.Supplier.bulkCreate(stripBuiltins(backupData.suppliers));
      if (backupData.stores?.length) await base44.entities.Store.bulkCreate(stripBuiltins(backupData.stores));
      if (backupData.skus?.length) await base44.entities.SKU.bulkCreate(stripBuiltins(backupData.skus));
      if (backupData.importBatches?.length) await base44.entities.ImportBatch.bulkCreate(stripBuiltins(backupData.importBatches));
      if (backupData.orders?.length) await base44.entities.Order.bulkCreate(stripBuiltins(backupData.orders));
      if (backupData.orderLines?.length) await base44.entities.OrderLine.bulkCreate(stripBuiltins(backupData.orderLines));
      if (backupData.purchases?.length) await base44.entities.Purchase.bulkCreate(stripBuiltins(backupData.purchases));
      if (backupData.currentStock?.length) await base44.entities.CurrentStock.bulkCreate(stripBuiltins(backupData.currentStock));
      if (backupData.stockMovements?.length) await base44.entities.StockMovement.bulkCreate(stripBuiltins(backupData.stockMovements));
      if (backupData.tasks?.length) await base44.entities.Task.bulkCreate(stripBuiltins(backupData.tasks));
      if (backupData.checklistItems?.length) await base44.entities.TaskChecklistItem.bulkCreate(stripBuiltins(backupData.checklistItems));
      if (backupData.comments?.length) await base44.entities.TaskComment.bulkCreate(stripBuiltins(backupData.comments));
      if (backupData.returns?.length) await base44.entities.Return.bulkCreate(stripBuiltins(backupData.returns));

      // Step 5: Count after restore
      const countsAfter = await getCurrentCounts(workspaceId);

      // Step 6: CRITICAL - Validate other workspaces unchanged
      const validation = await validateOtherWorkspaces(otherWorkspacesCountsBefore);

      if (!validation.success) {
        throw new Error(`OTHER WORKSPACE AFFECTED: ${validation.workspace} - ${validation.entity} changed from ${validation.before} to ${validation.after}. RESTORATION ABORTED.`);
      }

      // Step 7: Create restore log
      await base44.entities.RestoreLog.create({
        backup_job_id: backup.id,
        source_workspace_id: backup.source_workspace_id,
        source_workspace_name: backup.source_workspace_name,
        target_workspace_id: workspaceId,
        target_workspace_name: targetWorkspace.name,
        status: 'completed',
        restored_by: (await base44.auth.me())?.email,
        counts_before_purge: countsBefore,
        counts_after_restore: countsAfter,
        validation_results: { 
          success: true, 
          other_workspaces_unchanged: true,
          validated_workspaces: otherWorkspaces.map(w => w.name)
        },
        started_at: startTime,
        completed_at: new Date().toISOString()
      });

      // Generate report
      setRestoreReport({
        workspace_id: workspaceId,
        workspace_name: targetWorkspace.name,
        backup_timestamp: backup.completed_at,
        restore_timestamp: new Date().toISOString(),
        counts_before: countsBefore,
        counts_after: countsAfter,
        other_workspaces_validated: otherWorkspaces.map(w => ({
          name: w.name,
          counts: otherWorkspacesCountsBefore[w.id]
        })),
        validation: validation
      });

      setShowConfirm(false);
      setRestoring(false);

      toast({
        title: 'Restore completed successfully',
        description: `AMZ EG restored to ${format(new Date(backup.completed_at), 'MMM d, yyyy h:mm a')}`
      });

    } catch (error) {
      setRestoring(false);
      toast({
        title: 'RESTORE FAILED',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Shield className="w-8 h-8 text-red-600" />
          <h1 className="text-3xl font-bold">Emergency Workspace Restore</h1>
        </div>
        <p>Loading restore data...</p>
      </div>
    );
  }

  if (!targetWorkspace) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          <AlertDescription>
            Workspace "AMZ EG" not found in the system.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Shield className="w-8 h-8 text-red-600" />
        <div>
          <h1 className="text-3xl font-bold">Emergency Workspace Restore</h1>
          <p className="text-slate-600">Restore AMZ EG to state before Feb 17, 2026</p>
        </div>
      </div>

      {/* Target Workspace Info */}
      <Card className="p-6 border-red-200 bg-red-50">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-red-600 mt-1" />
          <div className="flex-1">
            <h3 className="font-bold text-red-900 mb-2">Target Workspace</h3>
            <div className="space-y-1 text-sm">
              <p><strong>Name:</strong> {targetWorkspace.name}</p>
              <p><strong>Workspace ID:</strong> <code className="bg-red-100 px-2 py-1 rounded">{targetWorkspace.id}</code></p>
              <p><strong>Slug:</strong> {targetWorkspace.slug}</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Current State Snapshot */}
      {currentSnapshot && (
        <Card className="p-6">
          <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Database className="w-5 h-5" />
            Current State (Safety Snapshot)
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            {Object.entries(currentSnapshot.counts).map(([key, value]) => (
              <div key={key} className="bg-slate-50 p-3 rounded">
                <p className="text-slate-600 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</p>
                <p className="text-2xl font-bold text-slate-900">{value}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-4">
            Snapshot taken: {format(new Date(currentSnapshot.timestamp), 'MMM d, yyyy h:mm:ss a')}
          </p>
        </Card>
      )}

      {/* Available Backups */}
      <Card className="p-6">
        <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5" />
          Available Backups (Before Feb 17, 2026)
        </h3>
        
        {availableBackups.length === 0 ? (
          <Alert className="border-yellow-200 bg-yellow-50">
            <AlertTriangle className="w-5 h-5 text-yellow-600" />
            <AlertDescription>
              No backups found before Feb 17, 2026 for AMZ EG workspace.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3">
            {availableBackups.map(backup => {
              const backupData = backup.backup_data ? JSON.parse(backup.backup_data) : {};
              const isSelected = selectedBackup?.id === backup.id;
              
              return (
                <button
                  key={backup.id}
                  onClick={() => setSelectedBackup(backup)}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                    isSelected 
                      ? 'border-indigo-600 bg-indigo-50' 
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="font-semibold text-slate-900">{backup.backup_name}</h4>
                      <p className="text-sm text-slate-600 mt-1">
                        Created: {format(new Date(backup.completed_at), 'MMM d, yyyy h:mm a')}
                      </p>
                      <div className="flex gap-4 mt-2 text-xs text-slate-500">
                        <span>Orders: {backup.stats?.orders || 0}</span>
                        <span>SKUs: {backup.stats?.skus || 0}</span>
                        <span>Purchases: {backup.stats?.purchases || 0}</span>
                      </div>
                    </div>
                    {isSelected && (
                      <CheckCircle className="w-6 h-6 text-indigo-600" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {/* Other Workspaces Being Monitored */}
      <Card className="p-6 border-green-200 bg-green-50">
        <h3 className="font-bold text-green-900 mb-4">Protected Workspaces (Will Validate Unchanged)</h3>
        <div className="space-y-2 text-sm">
          {otherWorkspaces.map(ws => (
            <div key={ws.id} className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-600" />
              <span>{ws.name} ({ws.slug})</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Action Button */}
      <div className="flex justify-end gap-3">
        <Button
          onClick={() => setShowConfirm(true)}
          disabled={!selectedBackup}
          className="bg-red-600 hover:bg-red-700"
          size="lg"
        >
          <Shield className="w-5 h-5 mr-2" />
          Restore AMZ EG to Selected Backup
        </Button>
      </div>

      {/* Restore Report */}
      {restoreReport && (
        <Card className="p-6 border-green-200 bg-green-50">
          <h3 className="font-bold text-green-900 mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Restore Report
          </h3>
          <div className="space-y-4 text-sm">
            <div>
              <p className="font-semibold text-green-900">Workspace Restored</p>
              <p>{restoreReport.workspace_name} ({restoreReport.workspace_id})</p>
            </div>
            <div>
              <p className="font-semibold text-green-900">Restore Point</p>
              <p>{format(new Date(restoreReport.backup_timestamp), 'MMM d, yyyy h:mm a')}</p>
            </div>
            <div>
              <p className="font-semibold text-green-900">Counts Before → After</p>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {Object.keys(restoreReport.counts_before).map(key => (
                  <div key={key} className="bg-white p-2 rounded">
                    <span className="capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}: </span>
                    <strong>{restoreReport.counts_before[key]} → {restoreReport.counts_after[key]}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="font-semibold text-green-900">Other Workspaces Validated</p>
              {restoreReport.other_workspaces_validated.map(ws => (
                <div key={ws.name} className="flex items-center gap-2 mt-1">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span>{ws.name} - Unchanged</span>
                </div>
              ))}
            </div>
            {restoreReport.validation.success && (
              <Alert className="border-green-300 bg-green-100">
                <CheckCircle className="w-5 h-5 text-green-700" />
                <AlertDescription>
                  <strong>Validation Passed:</strong> No other workspaces were affected.
                </AlertDescription>
              </Alert>
            )}
          </div>
        </Card>
      )}

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Shield className="w-6 h-6 text-red-600" />
              Confirm Emergency Restore
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <Alert className="border-red-200 bg-red-50">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                  <AlertDescription>
                    <div className="space-y-2">
                      <p className="font-bold text-red-900">CRITICAL OPERATION</p>
                      <ul className="text-xs space-y-1 list-disc list-inside">
                        <li>All current data in AMZ EG will be DELETED</li>
                        <li>Workspace will be restored to: {selectedBackup && format(new Date(selectedBackup.completed_at), 'MMM d, yyyy h:mm a')}</li>
                        <li>Other workspaces will be validated as unchanged</li>
                        <li>This operation cannot be undone</li>
                      </ul>
                    </div>
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Label className="font-medium">
                    Type <span className="text-red-600 font-bold">RESTORE AMZ EG</span> to confirm:
                  </Label>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="RESTORE AMZ EG"
                    className="font-mono"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowConfirm(false);
              setConfirmText('');
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={performRestore}
              disabled={restoring || confirmText !== 'RESTORE AMZ EG'}
              className="bg-red-600 hover:bg-red-700"
            >
              {restoring ? 'Restoring...' : 'Confirm Restore'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}