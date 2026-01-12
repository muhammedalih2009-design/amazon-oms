import React from 'react';
import { AlertTriangle, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PaywallBanner({ subscription, onUpgrade }) {
  if (subscription?.status === 'active') return null;

  const getMessage = () => {
    switch (subscription?.status) {
      case 'past_due':
        return 'Your subscription payment is past due. Please update your payment method.';
      case 'canceled':
        return 'Your subscription has been canceled. Upgrade to continue using all features.';
      case 'inactive':
        return 'Your subscription is inactive. Upgrade to unlock all features.';
      default:
        return 'Upgrade to Pro to unlock all features and remove restrictions.';
    }
  };

  return (
    <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4 mb-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-amber-100 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-amber-600" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-900">
            {subscription?.plan === 'trial' ? 'Trial Mode' : 'Limited Access'}
          </p>
          <p className="text-sm text-amber-700">{getMessage()}</p>
        </div>
        <Button 
          onClick={onUpgrade}
          className="bg-amber-600 hover:bg-amber-700 text-white"
        >
          <Lock className="w-4 h-4 mr-2" />
          Upgrade
        </Button>
      </div>
    </div>
  );
}