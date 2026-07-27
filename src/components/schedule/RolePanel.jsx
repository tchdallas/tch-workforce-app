import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Filter, Search, Check, GripVertical, ChevronUp, ChevronDown, RotateCcw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// The Roles control on the schedule builder. Two different things live here on
// purpose, because both answer "which positions do I look at first?":
//   • Show/hide  — per device (localStorage), your own working view
//   • Order      — per CLUB (app_settings), so the whole room sees the same grid
// Reordering is location_admin+ only; the database enforces the same bar.
export default function RolePanel({
  roles,                 // visibleRoles, already in the club's saved order
  roleFilter,            // ids to SHOW; [] = show all
  onSaveFilter,
  onToggleFilter,
  rolesInUse,
  locationName,
  canReorder = false,
  onReorder,             // (orderedIds) => void
  onResetOrder,
  hasCustomOrder = false,
  isSavingOrder = false,
}) {
  const [search, setSearch] = useState('');
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  const term = search.trim().toLowerCase();
  const shown = term ? roles.filter(r => r.name.toLowerCase().includes(term)) : roles;
  // Reordering is relative to the FULL list — a "move down" inside a filtered
  // view would land somewhere the user can't see. So it's off while searching.
  const reorderable = canReorder && !term;

  const move = (id, dir) => {
    const ids = roles.map(r => r.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    onReorder(next);
  };

  const drop = (targetId) => {
    if (!dragId || dragId === targetId) return;
    const ids = roles.map(r => r.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    onReorder(next);
  };

  return (
    <Popover onOpenChange={(o) => { if (!o) { setSearch(''); setDragId(null); setDragOverId(null); } }}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-9"
          title={canReorder
            ? 'Show, hide and reorder the positions in the grid'
            : 'Show or hide positions in the grid (saved per location)'}
        >
          <Filter className="w-4 h-4" /> Roles
          {roleFilter.length > 0 && (
            <span className="text-[10px] bg-primary text-primary-foreground rounded-full px-1.5 leading-tight">{roleFilter.length}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="p-2 border-b border-border">
          <div className="flex items-center gap-1.5 h-8 px-2 rounded-md border border-input bg-transparent">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              className="bg-transparent outline-none flex-1 text-sm placeholder:text-muted-foreground"
              placeholder="Search roles…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1.5 mt-2 text-xs">
            <button type="button" className="px-2 py-0.5 rounded bg-muted hover:bg-muted/70" onClick={() => onSaveFilter(rolesInUse)}>In use ({rolesInUse.length})</button>
            <button type="button" className="px-2 py-0.5 rounded bg-muted hover:bg-muted/70" onClick={() => onSaveFilter(roles.map(r => r.id))}>All</button>
            <button type="button" className="px-2 py-0.5 rounded bg-muted hover:bg-muted/70" onClick={() => onSaveFilter([])}>Clear</button>
            <span className="ml-auto text-muted-foreground">{roleFilter.length ? `${roleFilter.length} shown` : 'all shown'}</span>
          </div>
        </div>

        {canReorder && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border bg-muted/40 text-[11px] text-muted-foreground">
            {isSavingOrder
              ? <><Loader2 className="w-3 h-3 animate-spin shrink-0" /> Saving order…</>
              : <><GripVertical className="w-3 h-3 shrink-0" /> {term ? 'Clear the search to reorder' : 'Drag or use ▲▼ to set this club’s order'}</>}
            {hasCustomOrder && !term && (
              <button
                type="button"
                className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted hover:text-foreground"
                onClick={onResetOrder}
                title="Go back to the default order set on the Roles page"
              >
                <RotateCcw className="w-3 h-3" /> Reset
              </button>
            )}
          </div>
        )}

        <div className="max-h-[50vh] overflow-y-auto p-1.5 space-y-0.5">
          {shown.map(r => {
            const on = roleFilter.length === 0 || roleFilter.includes(r.id);
            const checked = roleFilter.includes(r.id);
            const idx = roles.findIndex(x => x.id === r.id);
            return (
              <div
                key={r.id}
                draggable={reorderable}
                onDragStart={reorderable ? (e) => { setDragId(r.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
                onDragOver={reorderable ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverId(r.id); } : undefined}
                onDragLeave={reorderable ? () => setDragOverId(prev => (prev === r.id ? null : prev)) : undefined}
                onDrop={reorderable ? (e) => { e.preventDefault(); drop(r.id); setDragId(null); setDragOverId(null); } : undefined}
                onDragEnd={reorderable ? () => { setDragId(null); setDragOverId(null); } : undefined}
                className={cn(
                  'group w-full flex items-center gap-1.5 pl-1 pr-1.5 rounded text-sm hover:bg-muted transition-colors',
                  dragId === r.id && 'opacity-40',
                  dragOverId === r.id && dragId !== r.id && 'ring-1 ring-primary'
                )}
              >
                {reorderable && (
                  <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0 cursor-grab active:cursor-grabbing" />
                )}
                <button
                  type="button"
                  onClick={() => onToggleFilter(r.id)}
                  className="flex-1 min-w-0 flex items-center gap-2 py-1.5 text-left"
                >
                  <span className={cn('w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0', checked ? 'bg-primary border-primary' : 'border-input')}>
                    {checked && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                  </span>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.color || '#6366f1' }} />
                  <span className={cn('truncate', !on && 'text-muted-foreground')}>{r.name}</span>
                </button>
                {reorderable && (
                  <span className="flex items-center shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button
                      type="button"
                      className="p-0.5 rounded hover:bg-background disabled:opacity-20 disabled:hover:bg-transparent"
                      onClick={() => move(r.id, -1)}
                      disabled={idx <= 0}
                      title={`Move ${r.name} up`}
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      className="p-0.5 rounded hover:bg-background disabled:opacity-20 disabled:hover:bg-transparent"
                      onClick={() => move(r.id, 1)}
                      disabled={idx < 0 || idx >= roles.length - 1}
                      title={`Move ${r.name} down`}
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </span>
                )}
              </div>
            );
          })}
          {shown.length === 0 && (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">No roles match “{search}”.</div>
          )}
        </div>

        <div className="border-t border-border px-2.5 py-1.5 text-[11px] text-muted-foreground leading-snug">
          Show/hide is saved on this device. Empty = show all.
          {canReorder
            ? <> Order applies to <span className="text-foreground">everyone</span> at {locationName || 'this location'}.</>
            : hasCustomOrder
              ? <> Order is set by {locationName || 'this location'}.</>
              : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
