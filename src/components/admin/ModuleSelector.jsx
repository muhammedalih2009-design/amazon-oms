import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  LayoutDashboard, Package, ShoppingCart, TrendingUp, ClipboardList, 
  Truck, RotateCcw, Users, CheckSquare, Settings, Store 
} from 'lucide-react';

const MODULE_GROUPS = {
  core: {
    name: 'Core',
    description: 'Essential features',
    modules: [
      { key: 'dashboard', name: 'Dashboard', icon: LayoutDashboard },
      { key: 'skus_products', name: 'SKUs / Products', icon: Package },
      { key: 'orders', name: 'Orders', icon: ShoppingCart }
    ]
  },
  operations: {
    name: 'Operations',
    description: 'Day-to-day operations',
    modules: [
      { key: 'purchases', name: 'Purchases', icon: Truck },
      { key: 'purchase_requests', name: 'Purchase Requests', icon: ClipboardList },
      { key: 'suppliers', name: 'Suppliers', icon: Users },
      { key: 'returns', name: 'Returns', icon: RotateCcw }
    ]
  },
  insights: {
    name: 'Insights',
    description: 'Analytics and tracking',
    modules: [
      { key: 'profitability', name: 'Profitability', icon: TrendingUp },
      { key: 'tasks', name: 'Tasks', icon: CheckSquare }
    ]
  },
  admin: {
    name: 'Admin',
    description: 'Management tools',
    modules: [
      { key: 'team', name: 'Team', icon: Users },
      { key: 'settings', name: 'Settings', icon: Settings },
      { key: 'stores', name: 'Backup & Data', icon: Store }
    ]
  }
};

const PLAN_PRESETS = {
  starter: ['dashboard', 'skus_products', 'orders', 'suppliers', 'settings'],
  growth: ['dashboard', 'skus_products', 'orders', 'purchases', 'suppliers', 'profitability', 'team', 'settings'],
  pro: Object.values(MODULE_GROUPS).flatMap(g => g.modules.map(m => m.key))
};

export default function ModuleSelector({ selectedModules, onChange, disabled }) {
  const [modules, setModules] = useState(selectedModules || PLAN_PRESETS.pro);

  const handleToggle = (moduleKey) => {
    if (disabled) return;
    const updated = modules.includes(moduleKey)
      ? modules.filter(k => k !== moduleKey)
      : [...modules, moduleKey];
    setModules(updated);
    onChange(updated);
  };

  const handleSelectAll = () => {
    if (disabled) return;
    const allKeys = Object.values(MODULE_GROUPS).flatMap(g => g.modules.map(m => m.key));
    setModules(allKeys);
    onChange(allKeys);
  };

  const handleClearAll = () => {
    if (disabled) return;
    setModules([]);
    onChange([]);
  };

  const handlePreset = (preset) => {
    if (disabled) return;
    const presetModules = PLAN_PRESETS[preset];
    setModules(presetModules);
    onChange(presetModules);
  };

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Enable Pages (Modules)</h3>
          <p className="text-sm text-slate-600">Choose which features are available in this workspace</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleClearAll} disabled={disabled}>
            Clear All
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handleSelectAll} disabled={disabled}>
            Select All
          </Button>
        </div>
      </div>

      {/* Presets */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <span className="text-sm text-slate-600">Quick presets:</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => handlePreset('starter')} className="h-7 px-3" disabled={disabled}>
            Starter
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => handlePreset('growth')} className="h-7 px-3" disabled={disabled}>
            Growth
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => handlePreset('pro')} className="h-7 px-3" disabled={disabled}>
            Pro (All)
          </Button>
        </div>
        <p className="text-xs text-slate-500 italic">
          💡 Presets only pre-fill selections. Click "Create Workspace" below to apply.
        </p>
      </div>

      {/* Module Groups */}
      <div className="grid gap-6">
        {Object.entries(MODULE_GROUPS).map(([groupKey, group]) => (
          <Card key={groupKey}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">{group.name}</CardTitle>
                  <p className="text-sm text-slate-500">{group.description}</p>
                </div>
                <Badge variant="outline">
                  {group.modules.filter(m => modules.includes(m.key)).length} / {group.modules.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                {group.modules.map(module => {
                  const Icon = module.icon;
                  const isEnabled = modules.includes(module.key);
                  
                  return (
                    <div
                      key={module.key}
                      className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                        isEnabled 
                          ? 'border-indigo-200 bg-indigo-50' 
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          isEnabled 
                            ? 'bg-indigo-600 text-white' 
                            : 'bg-slate-100 text-slate-400'
                        }`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div>
                          <p className={`font-medium ${isEnabled ? 'text-indigo-900' : 'text-slate-700'}`}>
                            {module.name}
                          </p>
                          <p className="text-xs text-slate-500">{module.key}</p>
                        </div>
                      </div>
                      <Switch
                        checked={isEnabled}
                        onCheckedChange={() => handleToggle(module.key)}
                        disabled={disabled}
                      />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
        <div>
          <p className="font-medium text-slate-900">
            {modules.length} modules enabled
          </p>
          <p className="text-sm text-slate-600">
            {modules.length === 0 && 'Select at least one module to continue'}
            {modules.length > 0 && 'Users will only see enabled modules'}
          </p>
        </div>
        {modules.length > 0 && (
          <Badge className="bg-green-100 text-green-800">
            Ready
          </Badge>
        )}
      </div>
    </div>
  );
}