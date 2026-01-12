import React from 'react';
import { Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function UploadRequirementsBanner() {
  const requiredColumns = [
    { name: 'sku_code', required: true },
    { name: 'product_name', required: true },
    { name: 'cost', required: true },
    { name: 'supplier', required: false },
    { name: 'stock', required: false },
    { name: 'image_url', required: false }
  ];

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-blue-100 rounded-lg shrink-0">
          <Info className="w-5 h-5 text-blue-600" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">
            CSV Columns Required:
          </h3>
          <div className="flex flex-wrap gap-2">
            {requiredColumns.map((col) => (
              <Badge
                key={col.name}
                variant={col.required ? "default" : "secondary"}
                className={col.required 
                  ? "bg-blue-600 hover:bg-blue-700 text-white" 
                  : "bg-blue-100 text-blue-700 hover:bg-blue-200"}
              >
                {col.name} {col.required && '*'}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}