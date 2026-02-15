import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Send, Loader, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

export default function TelegramSettings() {
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const { data } = await base44.functions.invoke('testTelegramConnection', {});
      
      if (data.ok) {
        toast({
          title: 'Telegram Connected ✅',
          description: 'Test message sent successfully',
        });
      } else {
        toast({
          title: 'Telegram Error',
          description: data.error,
          variant: 'destructive'
        });
      }
    } catch (error) {
      toast({
        title: 'Connection Failed',
        description: error.response?.data?.error || error.message,
        variant: 'destructive'
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <div className="p-6 border-b border-slate-200">
        <h2 className="text-lg font-semibold text-slate-900">Telegram Integration</h2>
        <p className="text-sm text-slate-500 mt-1">
          Configure Telegram bot to receive export notifications
        </p>
      </div>
      
      <div className="p-6 space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-medium text-blue-900 mb-2">Required Setup</h3>
          <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
            <li>Create a bot via <strong>@BotFather</strong> on Telegram</li>
            <li>Copy the <strong>Bot Token</strong> and set it in environment variables as <code className="bg-blue-100 px-1 rounded">TELEGRAM_BOT_TOKEN</code></li>
            <li>Add your bot to a group and promote it to <strong>Admin</strong></li>
            <li>Get the <strong>Chat ID</strong> (format: -100xxxxxxxxxx) and set it as <code className="bg-blue-100 px-1 rounded">TELEGRAM_CHAT_ID</code></li>
          </ol>
        </div>

        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
          <div>
            <p className="font-medium text-slate-900">Test Connection</p>
            <p className="text-sm text-slate-500">Send a test message to verify configuration</p>
          </div>
          <Button
            onClick={handleTestConnection}
            disabled={testing}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {testing ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Send Test Message
              </>
            )}
          </Button>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <p className="font-medium mb-1">Important Notes:</p>
              <ul className="space-y-1 list-disc list-inside">
                <li>Bot must be promoted to <strong>Admin</strong> in the group to send photos/media reliably</li>
                <li>Chat ID for groups always starts with <code className="bg-amber-100 px-1 rounded">-100</code></li>
                <li>Environment variables must be set in Settings → Environment Variables</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}