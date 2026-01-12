import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

export default function KPICard({ 
  title, 
  value, 
  change, 
  changeLabel, 
  icon: Icon,
  iconBg = 'bg-indigo-100',
  iconColor = 'text-indigo-600'
}) {
  const isPositive = change >= 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 hover:shadow-lg hover:shadow-slate-100/50 transition-all duration-300">
      <div className="flex items-start justify-between mb-4">
        <div className={`p-3 rounded-xl ${iconBg}`}>
          <Icon className={`w-6 h-6 ${iconColor}`} />
        </div>
        {change !== undefined && (
          <div className={`flex items-center gap-1 text-sm font-medium ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
            {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            {Math.abs(change)}%
          </div>
        )}
      </div>
      <div>
        <p className="text-sm text-slate-500 mb-1">{title}</p>
        <p className="text-2xl font-bold text-slate-900">{value}</p>
        {changeLabel && (
          <p className="text-xs text-slate-400 mt-1">{changeLabel}</p>
        )}
      </div>
    </div>
  );
}