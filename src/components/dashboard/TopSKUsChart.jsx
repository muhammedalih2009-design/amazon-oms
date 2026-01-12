import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function TopSKUsChart({ data = [] }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6">
      <h3 className="text-lg font-semibold text-slate-900 mb-6">Top 10 SKUs by Quantity</h3>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart 
            data={data} 
            layout="vertical"
            margin={{ top: 10, right: 30, left: 80, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" stroke="#94a3b8" fontSize={12} />
            <YAxis 
              type="category" 
              dataKey="sku_code" 
              stroke="#94a3b8" 
              fontSize={11}
              width={70}
              tickFormatter={(val) => val.length > 10 ? val.slice(0, 10) + '...' : val}
            />
            <Tooltip 
              contentStyle={{ 
                background: 'white', 
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
              }}
            />
            <Bar 
              dataKey="quantity" 
              fill="#8b5cf6" 
              radius={[0, 4, 4, 0]}
              name="Quantity Ordered"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}