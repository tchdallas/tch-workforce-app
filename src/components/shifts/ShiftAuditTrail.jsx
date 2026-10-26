import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useTeamMembers, useRoles, useLocations } from '@/lib/useAppData';
import { format } from 'date-fns';
import { Clock, User, RefreshCw, Plus, Trash2, ArrowRight, Ban } from 'lucide-react';

// Two writers feed a shift's history:
//   * the DB audit trigger — entity_type 'shifts' (the table name), with full
//     before/after row snapshots as objects; every insert/update/delete
//   * the app's logShiftEvent — entityType 'Shift', human-written details,
//     before/after (when present) as JSON strings
// The old version queried only 'Shift', so the richest records never showed.

const ACTION_META = {
  insert:            { icon: Plus,       color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20', label: 'Created' },
  update:            { icon: RefreshCw,  color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20',          label: 'Updated' },
  delete:            { icon: Trash2,     color: 'text-red-500 bg-red-50 dark:bg-red-900/20',             label: 'Deleted' },
  shift_created:     { icon: Plus,       color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20', label: 'Shift Created' },
  shift_updated:     { icon: RefreshCw,  color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20',          label: 'Shift Updated' },
  shift_deleted:     { icon: Trash2,     color: 'text-red-500 bg-red-50 dark:bg-red-900/20',             label: 'Shift Deleted' },
  shift_cancelled:   { icon: Ban,        color: 'text-red-500 bg-red-50 dark:bg-red-900/20',             label: 'Cancelled' },
  shift_assigned:    { icon: User,       color: 'text-violet-600 bg-violet-50 dark:bg-violet-900/20',    label: 'Reassigned' },
  shift_transferred: { icon: ArrowRight, color: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20',       label: 'Transferred' },
  shift_published:   { icon: Clock,      color: 'text-primary bg-primary/10',                            label: 'Published' },
};

// fields worth showing from DB row snapshots, in display order
const FIELDS = [
  ['team_member_id', 'Assigned to'],
  ['role_id', 'Role'],
  ['location_id', 'Location'],
  ['start_at', 'Starts'],
  ['end_at', 'Ends'],
  ['status', 'Status'],
  ['shift_type', 'Type'],
  ['break_minutes', 'Break (min)'],
  ['team_facing_notes', 'Team notes'],
];

const asObj = (v) => {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
};
const isTs = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v);

export default function ShiftAuditTrail({ shiftId }) {
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: roles = [] } = useRoles();
  const { data: locations = [] } = useLocations();

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['shift-audit', shiftId],
    // both writers: the DB trigger ('shifts') and app events ('Shift')
    queryFn: () => base44.entities.AuditLog.filter(
      { entityType: { $in: ['shifts', 'Shift'] }, entityId: shiftId }, '-created_date', 50),
    enabled: !!shiftId,
    placeholderData: [],
  });

  const nameOf = (id) => {
    const tm = teamMembers.find(t => t.id === id);
    return tm ? `${tm.preferredName || tm.firstName} ${tm.lastName}` : null;
  };
  const fmtVal = (key, v) => {
    if (v === null || v === undefined || v === '') return '—';
    if (key === 'team_member_id') return nameOf(v) || 'Open (unassigned)';
    if (key === 'role_id') return roles.find(r => r.id === v)?.name || '—';
    if (key === 'location_id') return locations.find(l => l.id === v)?.name || '—';
    if (isTs(v)) { const d = new Date(v); return isNaN(d) ? String(v) : format(d, 'EEE MMM d, h:mm a'); }
    return String(v);
  };
  const when = (log) => {
    const raw = log.createdDate || log.created_date || log.createdAt;
    if (!raw) return '—';
    const d = new Date(raw);
    return isNaN(d) ? '—' : format(d, 'MMM d, h:mm a');
  };

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
        const before = asObj(log.beforeValue);
        const after = asObj(log.afterValue);
        // a DB 'update' that flipped status to cancelled reads better as Cancelled
        let action = log.action;
        if (action === 'update' && before?.status !== 'cancelled' && after?.status === 'cancelled') action = 'shift_cancelled';
        if (action === 'update' && before?.status === 'draft' && after?.status === 'published') action = 'shift_published';
        const meta = ACTION_META[action] || ACTION_META.update;
        const Icon = meta.icon;

        // field diff from row snapshots (DB rows); created/deleted rows show a summary instead
        let diffs = [];
        if (before && after) {
          diffs = FIELDS
            .filter(([k]) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
            .map(([k, label]) => ({ label, from: fmtVal(k, before[k]), to: fmtVal(k, after[k]) }));
        }
        const snapshot = !before && after ? after : (!after && before ? before : null);

        return (
          <div key={log.id || i} className="flex gap-3 text-xs">
            <div className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${meta.color}`}>
              <Icon className="w-3 h-3" />
            </div>
            <div className="flex-1 min-w-0 pb-2 border-b border-border last:border-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">{meta.label}</span>
                <span className="text-muted-foreground shrink-0">{when(log)}</span>
              </div>
              {log.actorName && <p className="text-muted-foreground mt-0.5">by {log.actorName}</p>}
              {log.details && <p className="text-muted-foreground mt-0.5">{log.details}</p>}
              {diffs.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {diffs.map((d2, j) => (
                    <div key={j} className="flex items-center gap-1 flex-wrap text-[11px]">
                      <span className="text-muted-foreground">{d2.label}:</span>
                      <span className="line-through text-muted-foreground/60">{d2.from}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-foreground font-medium">{d2.to}</span>
                    </div>
                  ))}
                </div>
              )}
              {snapshot && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  {fmtVal('team_member_id', snapshot.team_member_id)}
                  {' · '}{fmtVal('role_id', snapshot.role_id)}
                  {' · '}{fmtVal('start_at', snapshot.start_at)}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
