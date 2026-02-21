import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { useLanguage } from '@/components/contexts/LanguageContext';
import { useToast } from '@/components/ui/use-toast';
import PremiumCollapsibleSection from '@/components/shared/PremiumCollapsibleSection';
import ModuleManagementModal from '@/components/admin/ModuleManagementModal';
import { DollarSign, MessageSquare, Eye, EyeOff, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const CURRENCIES = [
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'ر.س' },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'ج.م' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'د.ك' },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'ر.ق' },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: 'د.ب' },
  { code: 'OMR', name: 'Omani Rial', symbol: 'ر.ع' },
];

export default function Settings() {
  const { tenantId, tenant, isOwner, isPlatformAdmin } = useTenant();
  const { t, isRTL } = useLanguage();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showModuleModal, setShowModuleModal] = useState(false);

  // Currency settings
  const [currencyCode, setCurrencyCode] = useState('SAR');

  // Telegram settings
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [hasSavedToken, setHasSavedToken] = useState(false); // Track if token exists in DB

  useEffect(() => {
    if (tenantId) loadSettings();
  }, [tenantId]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const { data } = await base44.functions.invoke('getWorkspaceSettings', {
        workspace_id: tenantId
      });

      setCurrencyCode(data.currency_code || 'SAR');
      
      // Check if token exists in DB
      if (data.telegram_config_present) {
        setHasSavedToken(true);
        // Don't load actual token - only show placeholder
        setTelegramBotToken('');
        // Show masked chat_id or leave empty for user to re-enter
        setTelegramChatId(data.telegram_chat_id_display || '');
      } else {
        setHasSavedToken(false);
        setTelegramBotToken('');
        setTelegramChatId('');
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      toast({
        title: 'Error loading settings',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCurrency = async () => {
    setSaving(true);
    try {
      const { data, status } = await base44.functions.invoke('updateWorkspaceSettings', {
        workspace_id: tenantId,
        currency_code: currencyCode
      });

      // Success: check both data.ok and HTTP status
      if (status === 200 && data?.ok === true) {
        toast({
          title: t('settings.settings_saved'),
          description: `${t('settings.currency')}: ${currencyCode}`
        });
      } else {
        throw new Error(data?.error || 'Save failed');
      }
    } catch (error) {
      console.error('Currency save error:', error);
      toast({
        title: t('settings.settings_error'),
        description: error.response?.data?.error || error.message || 'Failed to save currency settings',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTelegram = async () => {
    // Don't allow saving if no new token entered and none previously saved
    if (!telegramBotToken && !hasSavedToken) {
      toast({
        title: t('settings.settings_error'),
        description: 'Please enter a bot token',
        variant: 'destructive'
      });
      return;
    }

    // If token was not changed but exists, don't send it (security)
    // Only send token if user just entered a new one
    if (telegramBotToken && telegramBotToken.trim()) {
      if (!telegramBotToken.includes(':') || telegramBotToken.length < 10) {
        toast({
          title: t('settings.settings_error'),
          description: 'Invalid token format. Token should contain ":" and be at least 10 characters',
          variant: 'destructive'
        });
        return;
      }
    }

    if (!telegramChatId || !telegramChatId.trim()) {
      toast({
        title: t('settings.settings_error'),
        description: 'Please enter a chat ID',
        variant: 'destructive'
      });
      return;
    }

    setSaving(true);
    try {
      // Only send token if it was entered by user (new or updated)
      const payload = {
        workspace_id: tenantId,
        telegram_chat_id: telegramChatId
      };

      if (telegramBotToken && telegramBotToken.trim()) {
        payload.telegram_bot_token = telegramBotToken;
      }

      const { data, status } = await base44.functions.invoke('updateWorkspaceSettings', payload);

      // Success: check both data.ok and HTTP status
      if (status === 200 && data?.ok === true) {
        // Mark as saved and reload to confirm persistence
        setHasSavedToken(true);
        setTelegramBotToken(''); // Clear token field after save
        
        toast({
          title: t('settings.settings_saved'),
          description: 'Telegram settings saved successfully'
        });

        // Reload to verify persistence
        setTimeout(() => loadSettings(), 500);
      } else {
        throw new Error(data?.error || 'Save failed');
      }
    } catch (error) {
      console.error('Telegram save error:', error);
      toast({
        title: t('settings.settings_error'),
        description: error.response?.data?.error || error.message || 'Failed to save Telegram settings',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestTelegram = async () => {
    // Validate before testing
    if (!telegramBotToken || telegramBotToken === '************') {
      toast({
        title: 'Validation error',
        description: 'Please enter a valid bot token first',
        variant: 'destructive'
      });
      return;
    }

    if (!telegramChatId) {
      toast({
        title: 'Validation error',
        description: 'Please enter a chat ID first',
        variant: 'destructive'
      });
      return;
    }

    setTesting(true);
    try {
      const { data, status } = await base44.functions.invoke('testTelegramNew', {
        workspace_id: tenantId,
        test_token: telegramBotToken,
        test_chat_id: telegramChatId
      });

      if (status === 200 && data.ok === true && data.success) {
        toast({
          title: 'Connection successful!',
          description: 'Test message sent to Telegram'
        });
      } else {
        toast({
          title: 'Connection failed',
          description: data.error || 'Could not connect to Telegram',
          variant: 'destructive'
        });
      }
    } catch (error) {
      console.error('Telegram test error:', error);
      toast({
        title: 'Failed to test connection',
        description: error.response?.data?.error || error.message || 'Network error',
        variant: 'destructive'
      });
    } finally {
      setTesting(false);
    }
  };

  const formatCurrencyExample = (code) => {
    const currency = CURRENCIES.find(c => c.code === code);
    if (!currency) return '';
    return `1,234.50 ${currency.symbol}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold text-slate-900">{t('settings.workspace_settings')}</h1>
        {(isOwner || isPlatformAdmin) && (
          <Button onClick={() => setShowModuleModal(true)} variant="outline">
            <Settings2 className="w-4 h-4 mr-2" />
            Manage Modules
          </Button>
        )}
      </div>

      {/* Currency Settings */}
      <PremiumCollapsibleSection
        id="currency_settings"
        icon={DollarSign}
        title={t('settings.currency')}
        subtitle={t('settings.currency_subtitle')}
        defaultOpen={true}
        workspaceId={tenantId}
      >
        <div className="space-y-6">
          <div className="space-y-2">
            <Label>{t('settings.currency')}</Label>
            <Select value={currencyCode} onValueChange={setCurrencyCode}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map(currency => (
                  <SelectItem key={currency.code} value={currency.code}>
                    {currency.code} - {currency.name} ({currency.symbol})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-sm text-slate-600 mb-1">{t('settings.currency_example')}:</p>
            <p className="text-lg font-semibold text-slate-900">
              {formatCurrencyExample(currencyCode)}
            </p>
          </div>

          <div className={`flex ${isRTL ? 'justify-start' : 'justify-end'}`}>
            <Button
              onClick={handleSaveCurrency}
              disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {saving ? '...' : t('settings.save')}
            </Button>
          </div>
        </div>
      </PremiumCollapsibleSection>

      {/* Telegram Integration */}
      <PremiumCollapsibleSection
        id="telegram_integration"
        icon={MessageSquare}
        title={t('settings.telegram_integration')}
        subtitle={t('settings.telegram_subtitle')}
        defaultOpen={false}
        workspaceId={tenantId}
      >
        <div className="space-y-6">
          <div className="space-y-2">
            <Label>{t('settings.bot_token')}</Label>
            {hasSavedToken && !telegramBotToken ? (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between">
                <span className="text-sm text-emerald-800">✓ Token saved</span>
                <button
                  onClick={() => {
                    setHasSavedToken(false);
                    setTelegramBotToken('');
                  }}
                  className="text-xs px-2 py-1 bg-emerald-100 hover:bg-emerald-200 rounded text-emerald-800"
                >
                  Change token
                </button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  type={showToken ? 'text' : 'password'}
                  value={telegramBotToken}
                  onChange={(e) => setTelegramBotToken(e.target.value)}
                  placeholder="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz"
                  className={isRTL ? 'text-right pr-12' : 'pr-12'}
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className={`absolute top-1/2 -translate-y-1/2 ${isRTL ? 'left-3' : 'right-3'} text-slate-400 hover:text-slate-600`}
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t('settings.chat_id')}</Label>
            <Input
              value={telegramChatId}
              onChange={(e) => setTelegramChatId(e.target.value)}
              placeholder="-1001234567890"
              className={isRTL ? 'text-right' : ''}
            />
          </div>

          <div className={`flex gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
            <Button
              onClick={handleTestTelegram}
              disabled={testing || !telegramBotToken || !telegramChatId}
              variant="outline"
            >
              {testing ? '...' : t('settings.test_connection')}
            </Button>
            <Button
              onClick={handleSaveTelegram}
              disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {saving ? '...' : t('settings.save')}
            </Button>
          </div>

          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-800">
              {isRTL 
                ? 'ملاحظة: سيتم استخدام إعدادات تيليجرام هذه لإرسال إشعارات الطلبات اليومية.'
                : 'Note: These Telegram settings will be used for sending daily order notifications.'}
            </p>
          </div>
        </div>
      </PremiumCollapsibleSection>

      <ModuleManagementModal
        open={showModuleModal}
        onClose={() => setShowModuleModal(false)}
        workspaceId={tenant?.id}
        workspaceName={tenant?.name}
      />
    </div>
  );
}