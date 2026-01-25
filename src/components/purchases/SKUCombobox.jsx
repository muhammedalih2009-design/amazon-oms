import React, { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Check, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function SKUCombobox({ skus, value, onChange, onProductInfo, onEnterPress }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [selectedSKU, setSelectedSKU] = useState(null);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  // Update selected SKU when value changes
  useEffect(() => {
    if (value) {
      const sku = skus.find(s => s.id === value);
      setSelectedSKU(sku);
      setSearch(sku?.sku_code || '');
      setError('');
    } else {
      setSelectedSKU(null);
      setSearch('');
      setError('');
    }
  }, [value, skus]);

  // Filter SKUs by search
  const filteredSKUs = skus.filter(sku => 
    sku.sku_code.toLowerCase().includes(search.toLowerCase()) ||
    sku.product_name.toLowerCase().includes(search.toLowerCase())
  );

  // Handle search input change
  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearch(val);
    setOpen(true);
    setError('');
    
    // If search is empty, clear selection
    if (!val) {
      onChange('');
      onProductInfo?.(null, null);
      setSelectedSKU(null);
      return;
    }

    // Check for exact match (case-insensitive, trimmed)
    const exactMatch = skus.find(s => 
      s.sku_code.toLowerCase().trim() === val.toLowerCase().trim()
    );
    
    if (exactMatch) {
      // Auto-select on exact match
      handleSelectSKU(exactMatch);
    }
  };

  // Handle SKU selection
  const handleSelectSKU = (sku) => {
    setSelectedSKU(sku);
    setSearch(sku.sku_code);
    onChange(sku.id);
    onProductInfo?.(sku.product_name, sku.cost_price);
    setOpen(false);
    setError('');
  };

  // Handle blur - validate input
  const handleBlur = () => {
    // Delay to allow dropdown click to register
    setTimeout(() => {
      if (!selectedSKU && search) {
        // Check if typed value matches any SKU
        const match = skus.find(s => 
          s.sku_code.toLowerCase().trim() === search.toLowerCase().trim()
        );
        
        if (match) {
          handleSelectSKU(match);
        } else {
          setError('SKU not found. Please check the code.');
          onChange('');
          onProductInfo?.(null, null);
        }
      }
      setOpen(false);
    }, 200);
  };

  // Handle keyboard navigation
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      
      // If there's an exact match, select it
      const exactMatch = skus.find(s => 
        s.sku_code.toLowerCase().trim() === search.toLowerCase().trim()
      );
      
      if (exactMatch) {
        handleSelectSKU(exactMatch);
        // Call onEnterPress to move to next field
        onEnterPress?.();
      } else if (filteredSKUs.length === 1) {
        // If only one result, select it
        handleSelectSKU(filteredSKUs[0]);
        onEnterPress?.();
      } else if (selectedSKU) {
        // If SKU already selected, move to next field
        onEnterPress?.();
      } else {
        setError('SKU not found. Please check the code.');
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  // Handle paste event
  const handlePaste = (e) => {
    const pastedText = e.clipboardData.getData('text').trim();
    
    // Check for exact match
    const match = skus.find(s => 
      s.sku_code.toLowerCase().trim() === pastedText.toLowerCase().trim()
    );
    
    if (match) {
      e.preventDefault();
      handleSelectSKU(match);
    }
  };

  return (
    <div className="space-y-2 relative">
      <Label>SKU *</Label>
      <div className="relative">
        <Input
          ref={inputRef}
          value={search}
          onChange={handleSearchChange}
          onBlur={handleBlur}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Type or paste SKU code..."
          className={cn(
            "pr-10",
            error && "border-red-500 focus-visible:ring-red-500"
          )}
          autoComplete="off"
        />
        {selectedSKU && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <Check className="w-4 h-4 text-emerald-600" />
          </div>
        )}
        {error && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <AlertCircle className="w-4 h-4 text-red-500" />
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {error}
        </p>
      )}

      {/* Dropdown */}
      {open && filteredSKUs.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 max-h-60 overflow-auto bg-white border border-slate-200 rounded-lg shadow-lg"
        >
          {filteredSKUs.map((sku) => (
            <div
              key={sku.id}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelectSKU(sku);
              }}
              className={cn(
                "px-3 py-2 cursor-pointer hover:bg-slate-100 transition-colors",
                selectedSKU?.id === sku.id && "bg-indigo-50"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 truncate">{sku.sku_code}</p>
                  <p className="text-xs text-slate-500 truncate">{sku.product_name}</p>
                </div>
                <div className="text-right ml-2">
                  <p className="text-xs text-slate-500">${sku.cost_price.toFixed(2)}</p>
                </div>
                {selectedSKU?.id === sku.id && (
                  <Check className="w-4 h-4 text-indigo-600 ml-2 shrink-0" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No results */}
      {open && search && filteredSKUs.length === 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg p-3">
          <p className="text-sm text-slate-500 text-center">No SKUs found</p>
        </div>
      )}
    </div>
  );
}