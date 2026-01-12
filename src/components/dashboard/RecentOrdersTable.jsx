import React from 'react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import StatusBadge from '@/components/ui/StatusBadge';
import { Eye, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function RecentOrdersTable({ orders = [] }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-slate-900">Recent Orders</h3>
        <Link to={createPageUrl('Orders')}>
          <Button variant="ghost" size="sm" className="text-indigo-600 hover:text-indigo-700">
            View All <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </Link>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Order ID</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
              <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Revenue</th>
              <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Profit</th>
            </tr>
          </thead>
          <tbody>
            {orders.slice(0, 5).map((order) => (
              <tr key={order.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                <td className="py-4 px-4">
                  <span className="font-medium text-slate-900">{order.amazon_order_id}</span>
                </td>
                <td className="py-4 px-4 text-slate-600">
                  {order.order_date ? format(new Date(order.order_date), 'MMM d, yyyy') : '-'}
                </td>
                <td className="py-4 px-4">
                  <StatusBadge status={order.status} />
                </td>
                <td className="py-4 px-4 text-right font-medium text-slate-900">
                  ${(order.net_revenue || 0).toFixed(2)}
                </td>
                <td className="py-4 px-4 text-right">
                  <span className={`font-medium ${(order.profit_loss || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    ${(order.profit_loss || 0).toFixed(2)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}