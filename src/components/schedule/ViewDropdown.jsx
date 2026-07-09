import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const ROLE_OPTIONS = [
  { label: 'Day', value: 'role_day' },
  { label: 'Week', value: 'role_week' },
  { label: '2 Weeks', value: 'role_2weeks' },
  { label: 'Month', value: 'role_month' },
];

const SUMMARY_OPTIONS = [
  { label: 'Day Summary', value: 'summary_day' },
  { label: 'Day Timeline', value: 'timeline_day' },
];

const MEMBER_OPTIONS = [
  { label: 'Day', value: 'member_day' },
  { label: 'Week', value: 'member_week' },
  { label: '2 Weeks', value: 'member_2weeks' },
  { label: '4 Weeks', value: 'member_4weeks' },
  { label: 'Month', value: 'member_month' },
];

const ALL_OPTIONS = [...ROLE_OPTIONS, ...MEMBER_OPTIONS, ...SUMMARY_OPTIONS];

export function getViewConfig(viewKey) {
  const defaults = { groupBy: 'role', days: 7 };
  if (!viewKey) return defaults;
  if (viewKey === 'summary_day') return { groupBy: 'summary', days: 1 };
  if (viewKey === 'timeline_day') return { groupBy: 'timeline', days: 1 };
  const [group, span] = viewKey.split('_');
  const groupBy = group === 'role' ? 'role' : 'team_member';
  const days = span === 'day' ? 1 : span === 'week' ? 7 : span === '2weeks' ? 14 : span === '4weeks' ? 28 : 30;
  return { groupBy, days };
}

export function getViewLabel(viewKey) {
  if (viewKey === 'summary_day') return 'Day Summary';
  if (viewKey === 'timeline_day') return 'Day Timeline';
  const opt = ALL_OPTIONS.find(o => o.value === viewKey);
  const [group] = (viewKey || '').split('_');
  const groupLabel = group === 'role' ? 'Area' : 'Employee';
  return opt ? `${opt.label} by ${groupLabel}` : 'Week by Area';
}

export default function ViewDropdown({ value = 'role_week', onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (v) => { onChange(v); setOpen(false); };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-border bg-card hover:bg-muted/60 transition-colors"
      >
        {getViewLabel(value)}
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border border-border bg-popover shadow-lg py-2">
          <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">View by Area</p>
          {ROLE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => select(opt.value)}
              className={cn(
                "w-full text-left px-4 py-1.5 text-sm hover:bg-muted/60 transition-colors",
                value === opt.value && "text-primary font-medium"
              )}
            >
              {opt.label}
            </button>
          ))}

          <div className="my-1.5 border-t border-border" />

          <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">View by Employee</p>
          {MEMBER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => select(opt.value)}
              className={cn(
                "w-full text-left px-4 py-1.5 text-sm hover:bg-muted/60 transition-colors",
                value === opt.value && "text-primary font-medium"
              )}
            >
              {opt.label}
            </button>
          ))}

          <div className="my-1.5 border-t border-border" />

          <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Summary</p>
          {SUMMARY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => select(opt.value)}
              className={cn(
                "w-full text-left px-4 py-1.5 text-sm hover:bg-muted/60 transition-colors",
                value === opt.value && "text-primary font-medium"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}