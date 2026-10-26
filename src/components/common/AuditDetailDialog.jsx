import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useTeamMembers, useRoles, useLocations } from '@/lib/useAppData';
import { format } from 'date-fns';

// Full drill-down for one audit event: who, what, where, when, and a
// field-by-field account of exactly what changed. Works for every audited
// table — ids are resolved to names where we know how, timestamps formatted,
// and the rest shown verbatim.

const SKIP = new Set(['id', 'created_at', 'updated_at']);
// columns that point at a team member, across all audited tables
const MEMBER_KEYS = /(team_member_id|author_id|actor_id|issued_by|created_by|reviewed_by|excused_by|voided_by|witness_id|counterpart_id|deleted_by|cancelled_by|edited_by|updated_by|appeal_reviewed_by|user_id)$/;

const asObj = (v) => {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
};
const isTs = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v);
const labelOf = (k) => {
  const t = k.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const entityLabel = (t) => (t || 'record').replace(/_/g, ' ');

export default function AuditDetailDialog({ log, onClose }) {
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: roles = [] } = useRoles();
  const { data: locations = [] } = useLocations();
  if (!log) return null;

  const nameOf = (id) => {
    const tm = teamMembers.find(t => t.id === id);
    return tm ? `${tm.preferredName || tm.firstName} ${tm.lastName}` : null;
  };
  const fmtVal = (k, v) => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'string' && MEMBER_KEYS.test(k)) return nameOf(v) || `#${String(v).slice(0, 8)}`;
    if (k === 'role_id') return roles.find(r => r.id === v)?.name || `#${String(v).slice(0, 8)}`;
    if (k === 'location_id') return locations.find(l => l.id === v)?.name || `#${String(v).slice(0, 8)}`;
    if (k.endsWith('_id')) return `#${String(v).slice(0, 8)}`;
    if (isTs(v)) { const d = new Date(v); return isNaN(d) ? String(v) : format(d, 'MMM d, yyyy h:mm a'); }
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  const before = asObj(log.beforeValue);
  const after = asObj(log.afterValue);
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
    .filter(k => !SKIP.has(k));
  const changed = (before && after)
    ? keys.filter(k => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
    : [];
  const snapshot = !before && after ? after : (!after && before ? before : null);
  const snapshotTitle = !before && after ? 'Created with' : 'Record at deletion';

  const actionColors = {
    insert: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    create: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    update: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    delete: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  };
  const when = log.createdDate || log.created_date || log.createdAt;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap text-base">
            <Badge className={`text-[10px] border-0 ${actionColors[log.action?.toLowerCase()] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>
              {log.action}
            </Badge>
            <span className="capitalize">{entityLabel(log.entityType)}</span>
          </DialogTitle>
          <DialogDescription asChild>
            <div className="text-xs space-y-0.5">
              <p><span className="text-muted-foreground">By</span> <b>{log.actorName || nameOf(log.actorId) || 'System'}</b>
                {when ? <> · {format(new Date(when), 'EEE, MMM d, yyyy · h:mm:ss a')}</> : null}</p>
              {log.locationId && <p><span className="text-muted-foreground">Location:</span> {fmtVal('location_id', log.locationId)}</p>}
              {log.entityId && <p className="font-mono break-all text-[10.5px] text-muted-foreground">Record: {log.entityId}</p>}
            </div>
          </DialogDescription>
        </DialogHeader>

        {log.details && (
          <p className="text-sm bg-muted/50 border border-border rounded-lg px-3 py-2">{log.details}</p>
        )}

        {changed.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              What changed ({changed.length} field{changed.length === 1 ? '' : 's'})
            </p>
            <div className="space-y-1.5">
              {changed.map(k => (
                <div key={k} className="text-sm border border-border rounded-lg px-3 py-2">
                  <p className="text-[11px] font-semibold text-muted-foreground">{labelOf(k)}</p>
                  <p className="flex items-center gap-1.5 flex-wrap">
                    <span className="line-through text-muted-foreground/70 break-words">{fmtVal(k, before[k])}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="font-medium break-words">{fmtVal(k, after[k])}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
        {before && after && changed.length === 0 && (
          <p className="text-sm text-muted-foreground">No field-level differences recorded.</p>
        )}

        {snapshot && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{snapshotTitle}</p>
            <div className="border border-border rounded-lg divide-y divide-border">
              {keys.filter(k => snapshot[k] !== null && snapshot[k] !== undefined && snapshot[k] !== '').map(k => (
                <div key={k} className="flex items-start justify-between gap-3 px-3 py-1.5 text-sm">
                  <span className="text-[11px] font-semibold text-muted-foreground pt-0.5 shrink-0">{labelOf(k)}</span>
                  <span className="text-right break-words min-w-0">{fmtVal(k, snapshot[k])}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
