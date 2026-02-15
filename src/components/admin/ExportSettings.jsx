import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { FileDown, Save, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';

export default function ExportSettings() {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pdfMode, setPdfMode] = useState('legacy');

  useEffect(() => {
    if (tenant) {
      loadSettings();
    }
  }, [tenant]);

  const loadSettings = async () => {
    try {
      const settings = tenant?.settings || {};
      setPdfMode(settings.defaultPdfMode || 'legacy');
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const currentSettings = tenant?.settings || {};
      await base44.entities.Tenant.update(tenant.id, {
        settings: {
          ...currentSettings,
          defaultPdfMode: pdfMode
        }
      });

      toast({
        title: 'Settings Saved',
        description: 'Export preferences updated successfully'
      });
    } catch (error) {
      toast({
        title: 'Failed to Save',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-center py-8">
          <Loader className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <div className="p-6 border-b border-slate-200">
        <h2 className="text-lg font-semibold text-slate-900">Export Settings</h2>
        <p className="text-sm text-slate-500 mt-1">
          Configure default PDF export behavior
        </p>
      </div>
      
      <div className="p-6 space-y-6">
        <div className="space-y-3">
          <Label>Default PDF Mode</Label>
          <Select value={pdfMode} onValueChange={setPdfMode}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="legacy">
                <div className="flex items-center gap-2">
                  <FileDown className="w-4 h-4" />
                  <div>
                    <div className="font-medium">Legacy (jsPDF)</div>
                    <div className="text-xs text-slate-500">Direct PDF download, English text only</div>
                  </div>
                </div>
              </SelectItem>
              <SelectItem value="print">
                <div className="flex items-center gap-2">
                  <FileDown className="w-4 h-4" />
                  <div>
                    <div className="font-medium">Print View</div>
                    <div className="text-xs text-slate-500">Browser print dialog, supports all languages</div>
                  </div>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-slate-500">
            Legacy mode generates PDF directly but may not render Arabic correctly. 
            Print View opens a new tab with proper formatting for all languages.
          </p>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {saving ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Settings
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}