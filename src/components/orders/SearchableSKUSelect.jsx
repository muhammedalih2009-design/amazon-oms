import React, { useState, useMemo } from 'react';
import { Check, ChevronsUpDown, Image as ImageIcon, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useDebounce } from '@/components/hooks/useDebounce';

export default function SearchableSKUSelect({ 
  skus, 
  currentStock,
  value, 
  onChange, 
  placeholder = "Search SKU or product name..." 
}) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 200);

  const selectedSKU = useMemo(() => 
    skus.find((sku) => sku.id === value),
    [skus, value]
  );

  const filteredSKUs = useMemo(() => {
    if (!debouncedSearch) return skus;
    
    const search = debouncedSearch.toLowerCase().trim();
    return skus.filter((sku) => 
      sku.sku_code?.toLowerCase().includes(search) ||
      sku.product_name?.toLowerCase().includes(search)
    );
  }, [skus, debouncedSearch]);

  const getStockLevel = (skuId) => {
    const stock = currentStock.find(s => s.sku_id === skuId);
    return stock?.quantity_available || 0;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {selectedSKU ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {selectedSKU.image_url ? (
                <img 
                  src={selectedSKU.image_url} 
                  alt={selectedSKU.product_name}
                  className="w-6 h-6 rounded object-cover"
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
              ) : (
                <div className="w-6 h-6 bg-slate-100 rounded flex items-center justify-center flex-shrink-0">
                  <ImageIcon className="w-3 h-3 text-slate-400" />
                </div>
              )}
              <span className="truncate font-medium">{selectedSKU.sku_code}</span>
              <span className="truncate text-slate-600">- {selectedSKU.product_name}</span>
            </div>
          ) : (
            <span className="text-slate-500">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[500px] p-0" align="start">
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <CommandInput 
              placeholder="Type SKU code or product name..." 
              value={searchTerm}
              onValueChange={setSearchTerm}
              className="border-0 focus:ring-0"
            />
          </div>
          <CommandList>
            <CommandEmpty>
              {debouncedSearch ? 'No products found.' : 'Start typing to search...'}
            </CommandEmpty>
            <CommandGroup className="max-h-[300px] overflow-auto">
              {filteredSKUs.map((sku) => {
                const stockLevel = getStockLevel(sku.id);
                return (
                  <CommandItem
                    key={sku.id}
                    value={sku.id}
                    onSelect={() => {
                      onChange(sku.id);
                      setOpen(false);
                      setSearchTerm('');
                    }}
                    className="cursor-pointer"
                  >
                    <div className="flex items-center gap-3 flex-1">
                      {sku.image_url ? (
                        <img 
                          src={sku.image_url} 
                          alt={sku.product_name}
                          className="w-10 h-10 rounded border border-slate-200 object-cover flex-shrink-0"
                          onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.nextSibling.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <div 
                        className="w-10 h-10 bg-slate-100 rounded border border-slate-200 flex items-center justify-center flex-shrink-0"
                        style={{ display: sku.image_url ? 'none' : 'flex' }}
                      >
                        <ImageIcon className="w-5 h-5 text-slate-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900">{sku.sku_code}</span>
                          <span className={cn(
                            "text-xs px-2 py-0.5 rounded-full",
                            stockLevel === 0 ? "bg-red-100 text-red-700" :
                            stockLevel <= 5 ? "bg-orange-100 text-orange-700" :
                            "bg-emerald-100 text-emerald-700"
                          )}>
                            Stock: {stockLevel}
                          </span>
                        </div>
                        <p className="text-sm text-slate-600 truncate">{sku.product_name}</p>
                      </div>
                      <Check
                        className={cn(
                          "ml-auto h-4 w-4 flex-shrink-0",
                          value === sku.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}