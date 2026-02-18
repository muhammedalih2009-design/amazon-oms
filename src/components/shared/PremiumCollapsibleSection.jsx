import React, { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STORAGE_PREFIX = 'ws';

export default function PremiumCollapsibleSection({ 
  id,
  icon: Icon,
  title, 
  subtitle,
  defaultOpen = false, 
  children, 
  onOpen,
  headerActions = [],
  workspaceId,
  className = ""
}) {
  const storageKey = workspaceId ? `${STORAGE_PREFIX}:${workspaceId}:settings:sections` : null;
  
  const [isOpen, setIsOpen] = useState(() => {
    if (storageKey) {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          return parsed[id] !== undefined ? parsed[id] : defaultOpen;
        }
      } catch (e) {
        console.error('Failed to parse localStorage:', e);
      }
    }
    return defaultOpen;
  });

  const [hasOpened, setHasOpened] = useState(isOpen);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (storageKey) {
      try {
        const saved = localStorage.getItem(storageKey);
        const parsed = saved ? JSON.parse(saved) : {};
        parsed[id] = isOpen;
        localStorage.setItem(storageKey, JSON.stringify(parsed));
      } catch (e) {
        console.error('Failed to save to localStorage:', e);
      }
    }
  }, [isOpen, storageKey, id]);

  const handleToggle = async () => {
    const newState = !isOpen;
    setIsOpen(newState);
    
    if (newState && !hasOpened) {
      setHasOpened(true);
      if (onOpen) {
        setIsLoading(true);
        try {
          await onOpen();
        } catch (error) {
          console.error('Error in onOpen:', error);
        } finally {
          setIsLoading(false);
        }
      }
    }
  };

  const handleHeaderAction = async (action) => {
    if (!isOpen) {
      setIsOpen(true);
      if (!hasOpened) {
        setHasOpened(true);
        if (onOpen) {
          setIsLoading(true);
          try {
            await onOpen();
          } catch (error) {
            console.error('Error in onOpen:', error);
          } finally {
            setIsLoading(false);
          }
        }
      }
    }
    
    if (action.onClick) {
      action.onClick();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleToggle();
    }
  };

  return (
    <div 
      className={`bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden transition-shadow duration-200 hover:shadow-md ${className}`}
    >
      <button
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-slate-50 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-inset group"
        aria-expanded={isOpen}
        aria-controls={`section-content-${id}`}
        type="button"
      >
        <div className="flex items-center gap-4 flex-1 min-w-0">
          {Icon && (
            <div className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-indigo-50 to-violet-50 rounded-lg flex items-center justify-center">
              <Icon className="w-5 h-5 text-indigo-600" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            {subtitle && (
              <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2 ml-4">
          {/* Header Actions */}
          {headerActions.length > 0 && (
            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              {headerActions.map((action, idx) => (
                <Button
                  key={idx}
                  size="sm"
                  variant={action.variant || 'outline'}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleHeaderAction(action);
                  }}
                  className={action.className || ''}
                >
                  {action.icon && <action.icon className="w-4 h-4 mr-1.5" />}
                  {action.label}
                </Button>
              ))}
            </div>
          )}
          
          {/* Chevron */}
          <div className="flex-shrink-0 transition-transform duration-250 ease-in-out" style={{
            transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)'
          }}>
            <ChevronRight className="w-5 h-5 text-slate-400" />
          </div>
        </div>
      </button>
      
      <div
        id={`section-content-${id}`}
        aria-hidden={!isOpen}
        className="transition-all duration-300 ease-in-out overflow-hidden"
        style={{
          maxHeight: isOpen ? '5000px' : '0',
          opacity: isOpen ? 1 : 0
        }}
      >
        <div className="px-6 py-6 border-t border-slate-100">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            hasOpened && children
          )}
        </div>
      </div>
    </div>
  );
}