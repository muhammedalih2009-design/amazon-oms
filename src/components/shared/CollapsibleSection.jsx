import React, { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/card';

export default function CollapsibleSection({ 
  title, 
  defaultOpen = false, 
  children, 
  onOpen,
  storageKey,
  className = ""
}) {
  const [isOpen, setIsOpen] = useState(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : defaultOpen;
    }
    return defaultOpen;
  });

  const [hasOpened, setHasOpened] = useState(isOpen);

  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(storageKey, JSON.stringify(isOpen));
    }
  }, [isOpen, storageKey]);

  const handleToggle = () => {
    const newState = !isOpen;
    setIsOpen(newState);
    
    if (newState && !hasOpened) {
      setHasOpened(true);
      if (onOpen) {
        onOpen();
      }
    }
  };

  return (
    <Card className={className}>
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between p-6 text-left hover:bg-slate-50 transition-colors rounded-t-xl"
        aria-expanded={isOpen}
        aria-controls={`section-${storageKey || title}`}
      >
        <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
        <div className="transition-transform duration-200">
          {isOpen ? (
            <ChevronDown className="w-5 h-5 text-slate-600" />
          ) : (
            <ChevronRight className="w-5 h-5 text-slate-600" />
          )}
        </div>
      </button>
      
      <div
        id={`section-${storageKey || title}`}
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: isOpen ? '100vh' : '0',
          opacity: isOpen ? 1 : 0
        }}
      >
        <div className="p-6 pt-0 border-t border-slate-200">
          {hasOpened && children}
        </div>
      </div>
    </Card>
  );
}