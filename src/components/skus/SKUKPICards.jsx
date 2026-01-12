import React from 'react';
import { Package, DollarSign, AlertTriangle } from 'lucide-react';
import { KPISkeleton } from '@/components/ui/LoadingSkeleton';

export default function SKUKPICards({ skus, currentStock, loading, lowStockThreshold = 5 }) {
  if (loading) {
    return <KPISkeleton />;
  }

  const totalSKUs = skus.length;

  const stockValue = skus.reduce((sum, sku) => {
    const stock = currentStock.find(s => s.sku_id === sku.id);
    const qty = stock?.quantity_available || 0;
    return sum + (qty * sku.cost_price);
  }, 0);

  const lowStockItems = skus.filter(sku => {
    const stock = currentStock.find(s => s.sku_id === sku.id);
    const qty = stock?.quantity_available || 0;
    return qty <= lowStockThreshold && qty > 0;
  }).length;

  const cards = [
    {
      title: 'Total SKUs',
      value: totalSKUs,
      icon: Package,
      iconBg: 'bg-indigo-100',
      iconColor: 'text-indigo-600'
    },
    {
      title: 'Stock Value',
      value: `$${stockValue.toFixed(2)}`,
      icon: DollarSign,
      iconBg: 'bg-green-100',
      iconColor: 'text-green-600'
    },
    {
      title: 'Low Stock Items',
      value: lowStockItems,
      icon: AlertTriangle,
      iconBg: 'bg-orange-100',
      iconColor: 'text-orange-600'
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
      {cards.map((card, idx) => (
        <div
          key={idx}
          className="bg-white rounded-2xl border border-slate-100 p-6 hover:shadow-lg transition-all duration-300"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">{card.title}</p>
              <p className="text-3xl font-bold text-slate-900">{card.value}</p>
            </div>
            <div className={`p-3 rounded-xl ${card.iconBg}`}>
              <card.icon className={`w-6 h-6 ${card.iconColor}`} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}