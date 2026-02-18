import React from 'react';
import { useTenant } from '@/components/hooks/useTenant';
import { Package, Database, Download, Plus } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import PremiumCollapsibleSection from '@/components/shared/PremiumCollapsibleSection';
import WorkspacePackageManager from '@/components/stores/WorkspacePackageManager';
import BackupManager from '@/components/stores/BackupManager';
import PaywallBanner from '@/components/ui/PaywallBanner';

export default function BackupData() {
  const { tenantId, tenant, subscription } = useTenant();
  const { toast } = useToast();

  const loadData = async (isRefresh = false) => {
    // Refresh data after operations
    if (isRefresh) {
      toast({ title: 'Data refreshed' });
    }
  };

  return (
    <div className="space-y-6">
      <PaywallBanner subscription={subscription} onUpgrade={() => {}} />

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Backup & Data</h1>
        <p className="text-slate-500">Manage workspace data packages and backups</p>
      </div>

      <PremiumCollapsibleSection
        id="workspace_data_package"
        icon={Package}
        title="Workspace Data Package"
        subtitle="Export/import workspace data"
        defaultOpen={false}
        workspaceId={tenantId}
        headerActions={[
          {
            label: 'Download',
            icon: Download,
            variant: 'outline',
            onClick: () => {
              toast({ title: 'Download started' });
            }
          }
        ]}
      >
        <WorkspacePackageManager 
          tenantId={tenantId} 
          tenantName={tenant?.name || 'Workspace'}
          onComplete={() => loadData(true)}
        />
      </PremiumCollapsibleSection>

      <PremiumCollapsibleSection
        id="backup_restore"
        icon={Database}
        title="Backup & Restore"
        subtitle="Snapshots & restore with recompute"
        defaultOpen={false}
        workspaceId={tenantId}
        headerActions={[
          {
            label: 'Create Backup',
            icon: Plus,
            variant: 'default',
            className: 'bg-indigo-600 hover:bg-indigo-700 text-white',
            onClick: () => {
              toast({ title: 'Creating backup...' });
            }
          }
        ]}
      >
        <BackupManager tenantId={tenantId} />
      </PremiumCollapsibleSection>
    </div>
  );
}