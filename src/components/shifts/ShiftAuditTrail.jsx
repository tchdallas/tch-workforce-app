import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { Clock, User, RefreshCw, Plus, Trash2, ArrowRight } from 'lucide-react';

const ACTION_META = {
  shift_created:    { icon: Plus,       color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20', label: 'Shift Created' },
  shift_updated:    { icon: RefreshCw,  color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20',         label: 'Shift Updated' },
  shift_deleted:    { icon: Trash2,     color: 'text-red-500 bg-red-50 dark:bg-red-900/20',            label: 'Shift Deleted' },
  shift_assigned:   { icon: User,       color: 'text-violet-600 bg-violet-50 dark:bg-violet-900/20',   label: 'Reassigned' },
  shift_transferred:{ icon: ArrowRight, color: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20',      label: 'Transferred' },
  shift_published:  { icon: Clock,      color: 'text-primary bg-primary/10',                           label: 'Published' },
};

export default function ShiftAuditTrail({ shiftId }) {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['shift-audit', shiftId],
    queryFn: () => base44.entities.AuditLog.filter({ entityType: 'Shift', entityId: shiftId }, '-created_date', 50),
    enabled: !!shiftId,
    placeholderData: [],
  });

  if (isLoading) {
    return (
      <div className="py-8 flex justify-center">
        <div className="w-5 h-5 border-2 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground italic">
        No history recorded for this shift yet.
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
      {logs.map((log, i) => {
        const meta = ACTION_META[log.action] || ACTION_META['shift_updated'];
        const Icon = meta.icon;

        let before, after;
        try { before = log.beforeValue ? JSON.parse(log.beforeValue) : null; } catch { before = null; }
        try { after = log.afterValue ? JSON.parse(log.afterValue) : null; } catch { after = null; }

        return (
          <div key={log.id || i} className="flex gap-3 text-xs">
            <div className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${meta.color}`}>
              <Icon className="w-3 h-3" />
            </div>
            <div className="flex-1 min-w-0 pb-2 border-b border-border last:border-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">{meta.label}</span>
                <span className="text-muted-foreground shrink-0">
                  {log.created_date ? format(new Date(log.created_date), 'MMM d, h:mm a') : '—'}
                </span>
              </div>
              {log.actorName && (
                <p className="text-muted-foreground mt-0.5">by {log.actorName}</p>
              )}
              {log.details && (
                <p className="text-muted-foreground mt-0.5">{log.details}</p>
              )}
              {before && after && (
                <div className="mt-1 space-y-0.5">
                  {Object.keys(after).map(key => {
                    if (before[key] === after[key]) return null;
                    return (
                      <div key={key} className="flex items-center gap-1 text-[11px]">
                        <span className="text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}:</span>
                        <span className="line-through text-muted-foreground/60">{String(before[key] ?? '—')}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-foreground font-medium">{String(after[key] ?? '—')}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}