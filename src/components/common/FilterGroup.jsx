import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// Multi-select filter group used inside a Filter popover (Team Members, Roles,
// Open Shifts…). `options` = [{ value, label }], `selected` = value[].
export default function FilterGroup({ title, options, selected, onToggle }) {
  if (!options.length) return null;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{title}</p>
      <div className="space-y-0.5">
        {options.map((opt) => {
          const on = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onToggle(opt.value)}
              className={cn('w-full flex items-center gap-2 px-2 py-1 rounded text-sm hover:bg-muted transition-colors', on && 'text-primary')}
            >
              <span className={cn('w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0', on ? 'bg-primary border-primary' : 'border-input')}>
                {on && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
              </span>
              <span className="truncate">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
