import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { useLanguage } from '@/components/contexts/LanguageContext';
import { useToast } from '@/components/ui/use-toast';
import PremiumCollapsibleSection from '@/components/shared/PremiumCollapsibleSection';
import { DollarSign, MessageSquare, Eye, EyeOff } from 'lucide-react';
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
  const { tenantId } = useTenant();
  const { t, isRTL } = useLanguage();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Currency settings
  const [currencyCode, setCurrencyCode] = useState('SAR');

  // Telegram settings
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [showToken, setShowToken] = useState(false);

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
      
      // We don't load the actual token from backend for security
      // But we can check if it's configured
      if (data.telegram_config_present) {
        setTelegramBotToken('************'); // Masked
        setTelegramChatId(data.telegram_chat_id_masked || '');
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCurrency = async () => {
    setSaving(true);
    try {
      const { data } = await base44.functions.invoke('updateWorkspaceSettings', {
        workspace_id: tenantId,
        currency_code: currencyCode
      });

      // CRITICAL: Check for explicit ok flag
      if (data?.ok === false) {
        throw new Error(data.error || 'Save failed');
      }

      toast({
        title: t('settings_saved'),
        description: `${t('currency')}: ${currencyCode}`
      });
    } catch (error) {
      toast({
        title: t('settings_error'),
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTelegram = async () => {
    if (!telegramBotToken || telegramBotToken === '************') {
      toast({
        title: t('settings_error'),
        description: 'Please enter a valid bot token',
        variant: 'destructive'
      });
      return;
    }

    if (!telegramChatId) {
      toast({
        title: t('settings_error'),
        description: 'Please enter a chat ID',
        variant: 'destructive'
      });
      return;
    }

    setSaving(true);
    try {
      const { data } = await base44.functions.invoke('updateWorkspaceSettings', {
        workspace_id: tenantId,
        telegram_bot_token: telegramBotToken,
        telegram_chat_id: telegramChatId
      });

      // CRITICAL: Check for explicit ok flag
      if (data?.ok === false) {
        throw new Error(data.error || 'Save failed');
      }

      toast({
        title: t('settings_saved'),
        description: 'Telegram credentials saved successfully'
      });
    } catch (error) {
      toast({
        title: t('settings_error'),
        description: error.message,
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
        title: t('telegram_error'),
        description: 'Please enter a valid bot token first',
        variant: 'destructive'
      });
      return;
    }

    if (!telegramChatId) {
      toast({
        title: t('telegram_error'),
        description: 'Please enter a chat ID first',
        variant: 'destructive'
      });
      return;
    }

    setTesting(true);
    try {
      const { data } = await base44.functions.invoke('testTelegram', {
        workspace_id: tenantId,
        test_token: telegramBotToken,
        test_chat_id: telegramChatId
      });

      if (data.success) {
        toast({
          title: 'Connection successful!',
          description: 'Test message sent to Telegram'
        });
      } else {
        toast({
          title: 'Connection failed',
          description: data.error,
          variant: 'destructive'
        });
      }
    } catch (error) {
      toast({
        title: 'Failed to send test message',
        description: error.message,
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
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">{t('workspace_settings')}</h1>
      </div>

      {/* Currency Settings */}
      <PremiumCollapsibleSection
        id="currency_settings"
        icon={DollarSign}
        title={t('currency')}
        subtitle={t('currency_subtitle')}
        defaultOpen={true}
        workspaceId={tenantId}
      >
        <div className="space-y-6">
          <div className="space-y-2">
            <Label>{t('currency')}</Label>
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
            <p className="text-sm text-slate-600 mb-1">{t('currency_example')}:</p>
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
              {saving ? '...' : t('save')}
            </Button>
          </div>
        </div>
      </PremiumCollapsibleSection>

      {/* Telegram Integration */}
      <PremiumCollapsibleSection
        id="telegram_integration"
        icon={MessageSquare}
        title={t('telegram_integration')}
        subtitle={t('telegram_subtitle')}
        defaultOpen={false}
        workspaceId={tenantId}
      >
        <div className="space-y-6">
          <div className="space-y-2">
            <Label>{t('bot_token')}</Label>
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
          </div>

          <div className="space-y-2">
            <Label>{t('chat_id')}</Label>
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
              {testing ? '...' : t('test_connection')}
            </Button>
            <Button
              onClick={handleSaveTelegram}
              disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {saving ? '...' : t('save')}
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
    </div>
  );
}