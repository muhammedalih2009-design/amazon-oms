import React, { useState, useRef, useEffect } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export default function SKUCombobox({ 
  skus, 
  value, 
  onChange, 
  onAutoFill,
  quantityFieldRef,
  label = "SKU",
  required = true,
  className 
}) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const selectedSKU = skus.find(s => s.id === value);

  // Filter SKUs based on search
  const filteredSKUs = skus.filter(sku => {
    const search = searchValue.toLowerCase();
    return (
      sku.sku_code.toLowerCase().includes(search) ||
      sku.product_name.toLowerCase().includes(search)
    );
  });

  // Handle SKU selection
  const handleSelect = (skuId) => {
    const sku = skus.find(s => s.id === skuId);
    if (sku) {
      onChange(skuId);
      setSearchValue('');
      setError(null);
      setOpen(false);
      
      // Auto-fill product info
      if (onAutoFill) {
        onAutoFill({
          product_name: sku.product_name,
          cost_price: sku.cost_price
        });
      }
      
      // Move focus to quantity field after selection
      if (quantityFieldRef?.current) {
        setTimeout(() => {
          quantityFieldRef.current?.focus();
        }, 100);
      }
    }
  };

  // Handle paste event
  const handlePaste = (e) => {
    const pastedText = e.clipboardData.getData('text').trim();
    
    // Try to find exact SKU match
    const matchedSKU = skus.find(s => 
      s.sku_code.toLowerCase() === pastedText.toLowerCase()
    );
    
    if (matchedSKU) {
      e.preventDefault();
      handleSelect(matchedSKU.id);
    }
  };

  // Handle input change
  const handleInputChange = (e) => {
    const newValue = e.target.value;
    setSearchValue(newValue);
    setError(null);
    
    // Auto-match exact SKU code
    const exactMatch = skus.find(s => 
      s.sku_code.toLowerCase() === newValue.toLowerCase().trim()
    );
    
    if (exactMatch) {
      handleSelect(exactMatch.id);
    }
  };

  // Handle keyboard events
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && searchValue) {
      e.preventDefault();
      
      // Try exact match first
      const exactMatch = skus.find(s => 
        s.sku_code.toLowerCase() === searchValue.toLowerCase().trim()
      );
      
      if (exactMatch) {
        handleSelect(exactMatch.id);
      } else if (filteredSKUs.length === 1) {
        // If only one result, select it
        handleSelect(filteredSKUs[0].id);
      } else if (filteredSKUs.length === 0) {
        setError('SKU not found. Please check the code.');
      } else {
        // Multiple matches, keep dropdown open
        setOpen(true);
      }
    }
  };

  // Handle input blur
  const handleBlur = () => {
    if (searchValue && !value) {
      const exactMatch = skus.find(s => 
        s.sku_code.toLowerCase() === searchValue.toLowerCase().trim()
      );
      
      if (!exactMatch) {
        setError('SKU not found. Please check the code.');
      }
    }
  };

  // Clear error when value changes
  useEffect(() => {
    if (value) {
      setError(null);
    }
  }, [value]);

  return (
    <div className={cn("space-y-2", className)}>
      <Label>
        {label} {required && <span className="text-red-500">*</span>}
      </Label>
      
      <Popover open={open} onOpenChange={setOpen}>
        <div className="relative">
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className={cn(
                "w-full justify-between font-normal",
                !value && "text-muted-foreground",
                error && "border-red-500 focus:ring-red-500"
              )}
              onClick={() => {
                setOpen(!open);
                if (!open) {
                  setTimeout(() => inputRef.current?.focus(), 100);
                }
              }}
            >
              {selectedSKU ? (
                <span className="truncate">
                  {selectedSKU.sku_code} - {selectedSKU.product_name}
                </span>
              ) : (
                "Paste or type SKU code..."
              )}
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          
          <PopoverContent className="w-full p-0" align="start" style={{ width: 'var(--radix-popover-trigger-width)' }}>
            <div className="p-2 border-b">
              <Input
                ref={inputRef}
                placeholder="Type or paste SKU code..."
                value={searchValue}
                onChange={handleInputChange}
                onPaste={handlePaste}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                className="h-9"
                autoFocus
              />
            </div>
            
            <div className="max-h-64 overflow-y-auto">
              {filteredSKUs.length === 0 ? (
                <div className="p-4 text-center text-sm text-slate-500">
                  No SKU found
                </div>
              ) : (
                filteredSKUs.map((sku) => (
                  <button
                    key={sku.id}
                    onClick={() => handleSelect(sku.id)}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2 hover:bg-slate-100 transition-colors text-left",
                      value === sku.id && "bg-slate-100"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-900 truncate">
                        {sku.sku_code}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {sku.product_name} • ${sku.cost_price.toFixed(2)}
                      </div>
                    </div>
                    {value === sku.id && (
                      <Check className="ml-2 h-4 w-4 text-indigo-600 shrink-0" />
                    )}
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </div>
      </Popover>
      
      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}
      
      {selectedSKU && (
        <div className="bg-slate-50 rounded-lg p-2 text-xs text-slate-600">
          <div><strong>Product:</strong> {selectedSKU.product_name}</div>
          <div><strong>Current Cost:</strong> ${selectedSKU.cost_price.toFixed(2)}</div>
        </div>
      )}
    </div>
  );
}