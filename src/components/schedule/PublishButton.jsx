import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Send, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function PublishButton({ onPublishAll, onPublishFiltered, onPublishSelected, draftCount, filteredDraftCount, selectedDraftCount, isPending }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const items = [
    {
      label: 'Publish All Drafts',
      description: `${draftCount} draft${draftCount !== 1 ? 's' : ''} total`,
      onClick: onPublishAll,
      disabled: draftCount === 0,
    },
    {
      label: 'Publish Filtered View',
      description: `${filteredDraftCount} draft${filteredDraftCount !== 1 ? 's' : ''} in current view`,
      onClick: onPublishFiltered,
      disabled: filteredDraftCount === 0,
    },
    {
      label: 'Publish Selected',
      description: selectedDraftCount > 0 ? `${selectedDraftCount} selected draft${selectedDraftCount !== 1 ? 's' : ''}` : 'No drafts selected',
      onClick: onPublishSelected,
      disabled: selectedDraftCount === 0,
    },
  ];

  return (
    <div ref={ref} className="relative flex items-center">
      {/* Main button */}
      <Button
        size="sm"
        className="gap-1.5 rounded-r-none pr-3"
        onClick={onPublishAll}
        disabled={isPending || draftCount === 0}
      >
        <Send className="w-4 h-4" />
        Publish {draftCount > 0 ? `(${draftCount})` : ''}
      </Button>
      {/* Dropdown arrow */}
      <Button
        size="sm"
        className="rounded-l-none border-l border-primary-foreground/20 px-1.5"
        onClick={() => setOpen(v => !v)}
        disabled={isPending}
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </Button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-64 bg-popover border border-border rounded-lg shadow-lg z-50 py-1">
          {items.map((item) => (
            <button
              key={item.label}
              className={cn(
                "flex flex-col w-full px-3 py-2 text-left hover:bg-accent transition-colors",
                item.disabled && "opacity-40 pointer-events-none"
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                setOpen(false);
                item.onClick?.();
              }}
            >
              <span className="text-sm font-medium">{item.label}</span>
              <span className="text-xs text-muted-foreground">{item.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}