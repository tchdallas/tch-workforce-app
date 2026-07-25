import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';

// Searchable team-member picker (search by name or badge #). Used anywhere a
// member is chosen from a potentially very long list.
const DOT = { good: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500' };
const BADGE = {
  good: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  warn: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  bad: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

export default function TeamMemberCombobox({
  value,
  onChange,
  eligibleTeamMembers = [],
  allowOpen = false, // include the "Open Shift" (unassigned) choice
  placeholder = 'Select team member',
  statusFor, // optional (memberId) => { tone, badge, reasons } for availability/conflict marks
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const nameOf = (tm) => tm.display_name || `${tm.preferredName || tm.firstName} ${tm.lastName}`;
  const activeMembers = eligibleTeamMembers.filter(tm => !tm.status || tm.status === 'active');
  const filtered = search.trim()
    ? activeMembers.filter(tm => `${nameOf(tm)} ${tm.tmNumber || ''}`.toLowerCase().includes(search.toLowerCase()))
    : activeMembers;

  const selectedMember = activeMembers.find(tm => tm.id === value);
  const selectedStatus = selectedMember && statusFor?.(selectedMember.id);
  const displayLabel = allowOpen && (value === '' || value === 'open')
    ? <span className="text-amber-600 font-medium">Open Shift</span>
    : selectedMember
      ? <span className="flex items-center gap-1.5">
          {nameOf(selectedMember)}
          {selectedStatus?.badge && selectedStatus.tone !== 'good' && (
            <span title={selectedStatus.reasons?.join(' · ')} className={`text-[10px] px-1.5 py-0.5 rounded ${BADGE[selectedStatus.tone] || ''}`}>{selectedStatus.badge}</span>
          )}
        </span>
      : <span className="text-muted-foreground">{placeholder}</span>;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setSearch(''); }}
        className="flex items-center justify-between w-full h-9 px-3 rounded-md border border-input bg-transparent text-sm shadow-sm hover:bg-accent/10 focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <span>{displayLabel}</span>
        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-lg">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                autoFocus
                className="w-full pl-7 pr-2 py-1.5 text-sm bg-transparent border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Search name or badge #…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {allowOpen && (
              <button
                type="button"
                className={`flex items-center justify-between w-full px-3 py-2 text-sm hover:bg-accent/10 ${(!value || value === 'open') ? 'bg-accent/10' : ''}`}
                onClick={() => { onChange('open'); setOpen(false); }}
              >
                <span className="text-amber-600 font-medium">Open Shift</span>
                {(!value || value === 'open') && <Check className="w-3.5 h-3.5 text-amber-600" />}
              </button>
            )}
            {filtered.map(tm => {
              const st = statusFor?.(tm.id);
              return (
                <button
                  key={tm.id}
                  type="button"
                  className={`flex items-center justify-between gap-2 w-full px-3 py-2 text-sm hover:bg-accent/10 ${value === tm.id ? 'bg-accent/10' : ''}`}
                  onClick={() => { onChange(tm.id); setOpen(false); }}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    {st && st.tone !== 'neutral' && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT[st.tone] || ''}`} />}
                    <span className="truncate">{nameOf(tm)}{tm.tmNumber ? ` — ${tm.tmNumber}` : ''}</span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {st?.badge && (
                      <span title={st.reasons?.join(' · ')} className={`text-[10px] px-1.5 py-0.5 rounded ${BADGE[st.tone] || ''}`}>{st.badge}</span>
                    )}
                    {value === tm.id && <Check className="w-3.5 h-3.5 text-primary" />}
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">No matches</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
