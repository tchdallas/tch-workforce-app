import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

// Checkbox list in a popover, for picking several roles or clubs at once. The
// trigger names the first couple of picks rather than showing a bare count, so
// you can tell at a glance who a policy reaches without opening it again.
export default function MultiPicker({
  options,          // [{ id, name }]
  value = [],       // selected ids
  onChange,
  placeholder = 'Choose…',
  emptyHint,
  searchable = true,
}) {
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const shown = term ? options.filter(o => o.name.toLowerCase().includes(term)) : options;

  const toggle = (id) =>
    onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);

  const picked = options.filter(o => value.includes(o.id));
  const label = picked.length === 0
    ? placeholder
    : picked.length <= 2
      ? picked.map(p => p.name).join(', ')
      : `${picked[0].name}, ${picked[1].name} +${picked.length - 2}`;

  return (
    <Popover onOpenChange={(o) => { if (!o) setSearch(''); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn('w-full justify-between font-normal', !picked.length && 'text-muted-foreground')}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="w-4 h-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
        {searchable && options.length > 8 && (
          <div className="p-2 border-b border-border">
            <div className="flex items-center gap-1.5 h-8 px-2 rounded-md border border-input">
              <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <input
                className="bg-transparent outline-none flex-1 text-sm placeholder:text-muted-foreground"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        )}
        <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
          {shown.map(o => (
            <button
              key={o.id}
              type="button"
              onClick={() => toggle(o.id)}
              className="w-full flex items-center gap-2 px-2 py-2 rounded text-sm hover:bg-muted transition-colors text-left"
            >
              <span className={cn(
                'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                value.includes(o.id) ? 'bg-primary border-primary' : 'border-input'
              )}>
                {value.includes(o.id) && <Check className="w-3 h-3 text-primary-foreground" />}
              </span>
              <span className="truncate">{o.name}</span>
            </button>
          ))}
          {shown.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {emptyHint || 'Nothing to choose from.'}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
