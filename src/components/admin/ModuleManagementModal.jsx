import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { Loader, Save, RefreshCw } from 'lucide-react';
import { WORKSPACE_MODULES } from '@/components/shared/modulesConfig';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useTenant } from '@/components/hooks/useTenant';

export default function ModuleManagementModal({ open, onClose, workspaceId, workspaceName }) {
  const { toast } = useToast();
  const { refresh } = useTenant();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [moduleStates, setModuleStates] = useState({});
  const [initialStates, setInitialStates] = useState({});

  useEffect(() => {
    if (open && workspaceId) {
      loadModules();
    }
  }, [open, workspaceId]);

  const loadModules = async () => {
    setLoading(true);
    try {
      const { data } = await base44.functions.invoke('manageWorkspaceModules', {
        action: 'list',
        workspace_id: workspaceId
      });

      if (!data.ok) {
        throw new Error(data.error || 'Failed to load modules');
      }

      // Build state map from existing modules
      const stateMap = {};
      const modules = data.modules || [];
      
      // Initialize all modules from config
      WORKSPACE_MODULES.forEach(module => {
        const existing = modules.find(m => m.module_key === module.key);
        stateMap[module.key] = existing ? existing.enabled : true; // Default to enabled
      });

      setModuleStates(stateMap);
      setInitialStates(stateMap);
    } catch (error) {
      console.error('[Module Management] Load error:', error);
      toast({
        title: 'Failed to load modules',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = (moduleKey) => {
    setModuleStates(prev => ({
      ...prev,
      [moduleKey]: !prev[moduleKey]
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Get list of enabled modules
      const modulesToEnable = Object.entries(moduleStates)
        .filter(([_, enabled]) => enabled)
        .map(([key, _]) => key);

      const { data } = await base44.functions.invoke('manageWorkspaceModules', {
        action: 'bulk_update',
        workspace_id: workspaceId,
        modules_to_enable: modulesToEnable
      });

      if (!data.ok) {
        throw new Error(data.error || 'Failed to save modules');
      }

      toast({
        title: 'Success',
        description: 'Module settings saved successfully'
      });

      setInitialStates(moduleStates);
      
      // CRITICAL: Refresh workspace context to update modules instantly
      if (refresh) {
        await refresh();
      }
      
      // Close modal and let context update propagate
      onClose();
    } catch (error) {
      console.error('[Module Management] Save error:', error);
      toast({
        title: 'Failed to save',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setModuleStates(initialStates);
  };

  const hasChanges = JSON.stringify(moduleStates) !== JSON.stringify(initialStates);
  const enabledCount = Object.values(moduleStates).filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Modules</DialogTitle>
          <DialogDescription>
            Configure which features are enabled for <strong>{workspaceName}</strong>
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="w-6 h-6 animate-spin text-indigo-600" />
          </div>
        ) : (
          <div className="space-y-6">
            <Alert>
              <AlertDescription>
                <strong>Important:</strong> Disabled modules will be hidden from all workspace members.
                Settings always remain accessible to workspace owners.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              {WORKSPACE_MODULES.map(module => (
                <div
                  key={module.key}
                  className="flex items-center justify-between p-4 rounded-lg border hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <module.icon className="w-5 h-5 text-slate-600" />
                    <div>
                      <p className="font-medium text-slate-900">{module.label}</p>
                      <p className="text-xs text-slate-500">{module.group}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-medium ${moduleStates[module.key] ? 'text-green-600' : 'text-slate-400'}`}>
                      {moduleStates[module.key] ? 'Enabled' : 'Disabled'}
                    </span>
                    <Switch
                      checked={moduleStates[module.key] || false}
                      onCheckedChange={() => handleToggle(module.key)}
                      disabled={module.key === 'settings' || module.key === 'dashboard'} // Dashboard and Settings always enabled
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-4 border-t">
              <div className="text-sm text-slate-600">
                {enabledCount} of {WORKSPACE_MODULES.length} modules enabled
              </div>
              <div className="flex gap-2">
                {hasChanges && (
                  <Button variant="outline" onClick={handleReset} disabled={saving}>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Reset
                  </Button>
                )}
                <Button onClick={handleSave} disabled={saving || !hasChanges}>
                  {saving ? (
                    <Loader className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  Save Changes
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}