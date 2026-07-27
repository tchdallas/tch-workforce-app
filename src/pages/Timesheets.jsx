import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabase';
import { format, startOfWeek, addDays } from 'date-fns';
import PageHeader from '@/components/common/PageHeader';
import LocationSelector from '@/components/common/LocationSelector';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useTeamMembers, useLocations } from '@/lib/useAppData';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { Camera, Pencil, Download, AlertTriangle, Check, Bell, CheckCircle2, Clock } from 'lucide-react';
import { toast } from 'sonner';
import {
  approveEntry, proposeEntry, acceptCounter, forceReminder, markExported,
} from '@/lib/timesheets';
import { cn } from '@/lib/utils';
import { invalidateNavBadges } from '@/hooks/useNavBadges';

const fmtDT = (d) => format(new Date(d), "yyyy-MM-dd'T'HH:mm");

// Where an entry stands in the approval flow. Verified is deliberately quiet —
// it's the expected end state, and badging every settled row would bury the
// handful that actually need someone.
function StatusBadge({ e }) {
  if (!e.clockOut) return null;
  if (e.status === 'verified') {
    return (
      <span title={e.exportedAt ? `Exported ${format(new Date(e.exportedAt), 'MMM d')}` : 'Verified — will export'}>
        <CheckCircle2 className={cn('w-3.5 h-3.5', e.exportedAt ? 'text-muted-foreground' : 'text-emerald-500')} />
      </span>
    );
  }
  if (e.status === 'pending_member') {
    return (
      <Badge className="text-[10px] border-0 bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400 gap-1">
        <Clock className="w-2.5 h-2.5" /> with team member
      </Badge>
    );
  }
  return (
    <Badge className="text-[10px] border-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
      {e.proposedAt ? 'they proposed a change' : 'needs approval'}
    </Badge>
  );
}
// Paylocity forbids commas and most special characters in text fields
const sanitize = (s) => String(s ?? '').replace(/[,\-._&|:*%+$@!?~[\];{}#"']/g, ' ').replace(/\s+/g, ' ').trim();

export default function Timesheets() {
  const queryClient = useQueryClient();
  const { member: currentMember, assignedLocationIds } = useCurrentMember();
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: locations = [] } = useLocations();

  const [rangeStart, setRangeStart] = useState(format(startOfWeek(new Date(), { weekStartsOn: 0 }), 'yyyy-MM-dd'));
  const [rangeEnd, setRangeEnd] = useState(format(addDays(startOfWeek(new Date(), { weekStartsOn: 0 }), 6), 'yyyy-MM-dd'));
  const [selectedLocation, setSelectedLocation] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [editEntry, setEditEntry] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [photoUrl, setPhotoUrl] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);

  const { data: settings = [] } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => base44.entities.AppSetting.list(),
    placeholderData: [],
  });
  const detcode = settings.find(s => s.key === 'paylocity_detcode' && s.scope === 'company')?.value || 'REG';

  const { data: entries = [] } = useQuery({
    queryKey: ['time-entries', rangeStart, rangeEnd, selectedLocation],
    queryFn: () => {
      const filter = {
        clockIn: { $gte: `${rangeStart}T00:00:00`, $lt: `${format(addDays(new Date(rangeEnd + 'T00:00:00'), 1), 'yyyy-MM-dd')}T00:00:00` },
      };
      if (selectedLocation) filter.locationId = selectedLocation;
      return base44.entities.TimeEntry.filter(filter, 'clockIn');
    },
    placeholderData: [],
  });

  // scheduled shifts linked to these entries (for late/early/unscheduled flags)
  const linkedShiftIds = useMemo(() => [...new Set(entries.map(e => e.shiftId).filter(Boolean))], [entries]);
  const { data: linkedShifts = [] } = useQuery({
    queryKey: ['timesheet-shifts', linkedShiftIds.join(',')],
    queryFn: () => base44.entities.Shift.filter({ id: { $in: linkedShiftIds } }),
    enabled: linkedShiftIds.length > 0,
    placeholderData: [],
  });
  const shiftById = useMemo(() => new Map(linkedShifts.map(s => [s.id, s])), [linkedShifts]);

  const punctuality = (e) => {
    if (!e.shiftId) return { label: 'unscheduled', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' };
    const sh = shiftById.get(e.shiftId);
    if (!sh) return null;
    const mins = Math.round((new Date(e.clockIn) - new Date(sh.startDateTime)) / 60000);
    if (mins > 5) return { label: `${mins}m late`, cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
    if (mins < -5) return { label: `${Math.abs(mins)}m early`, cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' };
    return { label: 'on time', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' };
  };

  const memberById = useMemo(() => new Map(teamMembers.map(m => [m.id, m])), [teamMembers]);
  const nameOf = (id) => {
    const m = memberById.get(id);
    return m ? `${m.preferredName || m.firstName} ${m.lastName}` : 'Unknown';
  };
  const hoursOf = (e) => e.clockOut ? (new Date(e.clockOut) - new Date(e.clockIn)) / 3600000 : null;

  // group entries by member for display (searchable by name or badge #)
  const grouped = useMemo(() => {
    const map = new Map();
    entries.forEach(e => {
      if (!map.has(e.teamMemberId)) map.set(e.teamMemberId, []);
      map.get(e.teamMemberId).push(e);
    });
    const q = memberSearch.trim().toLowerCase();
    return [...map.entries()]
      .filter(([tmId]) => {
        if (!q) return true;
        const m = memberById.get(tmId);
        return `${nameOf(tmId)} ${m?.tmNumber || ''}`.toLowerCase().includes(q);
      })
      .sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])));
  }, [entries, teamMembers, memberSearch]); // eslint-disable-line

  const totalHours = entries.reduce((acc, e) => acc + (hoursOf(e) || 0), 0);
  const openEntries = entries.filter(e => !e.clockOut);
  const missingBadge = [...new Set(entries.filter(e => !memberById.get(e.teamMemberId)?.tmNumber).map(e => e.teamMemberId))];

  // export bookkeeping: what ships, what gets left behind, and who to chase
  const verifiedExportable = entries.filter(
    e => e.status === 'verified' && e.clockOut && memberById.get(e.teamMemberId)?.tmNumber
  );
  const alreadyExported = verifiedExportable.filter(e => e.exportedAt).length;
  const unverified = entries.filter(e => e.clockOut && e.status && e.status !== 'verified');
  const unverifiedPeople = useMemo(() => {
    const m = new Map();
    unverified.forEach(e => {
      const cur = m.get(e.teamMemberId) || { id: e.teamMemberId, count: 0, waitingOnMember: true };
      cur.count += 1;
      // if anything is still on the manager's desk, that's the actionable half
      if (e.status !== 'pending_member') cur.waitingOnMember = false;
      m.set(e.teamMemberId, cur);
    });
    return [...m.values()].sort((a, b) => nameOf(a.id).localeCompare(nameOf(b.id)));
  }, [unverified]); // eslint-disable-line
  const needsMe = entries.filter(e => e.clockOut && e.status === 'pending_manager').length;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['time-entries'] });
    invalidateNavBadges(queryClient); // approving drops the Timesheets bubble now, not on next reload
  };

  // A manager no longer writes the clock columns directly — the database revokes
  // that. Edits are *proposed*, and the team member has to consent before the
  // hours become payroll data.
  const saveEdit = useMutation({
    mutationFn: () => proposeEntry(editEntry.id, editForm.clockIn, editForm.clockOut, editForm.editNote),
    onSuccess: () => {
      refresh();
      setEditEntry(null);
      toast.success('Sent to the team member to confirm');
    },
    onError: (e) => toast.error(e.message || 'Could not save'),
  });

  const approve = useMutation({
    mutationFn: (e) => (e.status === 'pending_manager' && e.proposedAt ? acceptCounter(e.id) : approveEntry(e.id)),
    onSuccess: () => { refresh(); toast.success('Verified'); },
    onError: (e) => toast.error(e.message),
  });

  const remind = useMutation({
    mutationFn: (id) => forceReminder(id, null),
    onSuccess: () => toast.success('Reminder sent'),
    onError: (e) => toast.error(e.message),
  });

  const viewPhoto = async (path) => {
    const { data, error } = await supabase.storage.from('clock-photos').createSignedUrl(path, 300);
    if (error) toast.error('Could not load photo');
    else setPhotoUrl(data.signedUrl);
  };

  // Paylocity Universal Time Import: 24 columns, NO header row, plain CSV.
  // EMPLOYEE ID | DET | DETCODE | HOURS | ... | BEGIN DATE (col 15) | END DATE (col 16) | ...
  // Only verified entries leave the building. Unverified ones aren't blocked —
  // they're just excluded, and named in the confirm dialog so you can see whose
  // pay is about to be short rather than reading a bare count.
  const exportCsv = async () => {
    const exportable = entries.filter(e => e.status === 'verified');
    const rows = exportable
      .filter(e => e.clockOut && memberById.get(e.teamMemberId)?.tmNumber)
      .map(e => {
        const cols = new Array(24).fill('');
        cols[0] = sanitize(memberById.get(e.teamMemberId).tmNumber);
        cols[1] = 'E';
        cols[2] = sanitize(detcode) || 'REG';
        cols[3] = hoursOf(e).toFixed(2);
        cols[14] = format(new Date(e.clockIn), 'MM/dd/yyyy HH:mm');
        cols[15] = format(new Date(e.clockOut), 'MM/dd/yyyy HH:mm');
        return cols.join(',');
      });
    if (rows.length === 0) { toast.error('No verified entries with badge numbers in this range'); return; }
    const blob = new Blob([rows.join('\r\n') + '\r\n'], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paylocity_time_import_${rangeStart}_${rangeEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    // stamp what went out, so a repeat run is visibly a re-export
    try {
      await markExported(exportable.filter(e => memberById.get(e.teamMemberId)?.tmNumber).map(e => e.id));
      refresh();
    } catch { /* the file is already downloaded; don't fail the export over bookkeeping */ }
    setExportOpen(false);
    toast.success(`Exported ${rows.length} entries`);
  };

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Timesheets" subtitle={`${entries.length} entries · ${totalHours.toFixed(1)} hours`}>
        <Button size="sm" className="gap-1.5" onClick={() => setExportOpen(true)}>
          <Download className="w-4 h-4" /> Export for Paylocity
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <LocationSelector
          value={selectedLocation}
          onChange={setSelectedLocation}
          className="w-[200px]"
          allowedIds={assignedLocationIds.length > 0 ? assignedLocationIds : undefined}
        />
        <div className="flex items-center gap-2">
          <Input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)} className="w-[150px]" />
          <span className="text-muted-foreground text-sm">to</span>
          <Input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} className="w-[150px]" />
        </div>
        <Input
          placeholder="Search name or badge #…"
          value={memberSearch}
          onChange={e => setMemberSearch(e.target.value)}
          className="w-[200px]"
        />
        {openEntries.length > 0 && (
          <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            {openEntries.length} still clocked in
          </Badge>
        )}
        {needsMe > 0 && (
          <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            {needsMe} need{needsMe === 1 ? 's' : ''} your approval
          </Badge>
        )}
      </div>

      {grouped.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-10 text-center text-sm text-muted-foreground">
          No time entries in this range.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([tmId, list]) => {
            const memberTotal = list.reduce((acc, e) => acc + (hoursOf(e) || 0), 0);
            const m = memberById.get(tmId);
            return (
              <div key={tmId} className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b border-border">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{nameOf(tmId)}</span>
                    {m?.tmNumber
                      ? <span className="text-xs text-muted-foreground">#{m.tmNumber}</span>
                      : <Badge variant="secondary" className="text-[10px] bg-red-100 text-red-700">no badge #</Badge>}
                  </div>
                  <span className="text-sm font-medium">{memberTotal.toFixed(2)} hrs</span>
                </div>
                <div className="divide-y divide-border">
                  {list.map(e => (
                    <div key={e.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <span className="w-24 text-muted-foreground">{format(new Date(e.clockIn), 'EEE, MMM d')}</span>
                      <span className="tabular-nums">{format(new Date(e.clockIn), 'h:mm a')}</span>
                      <span className="text-muted-foreground">–</span>
                      {e.clockOut
                        ? <span className="tabular-nums">{format(new Date(e.clockOut), 'h:mm a')}</span>
                        : <Badge className="text-[10px] bg-emerald-100 text-emerald-700 border-0">on the clock</Badge>}
                      <span className="ml-auto tabular-nums text-muted-foreground">
                        {e.clockOut ? `${hoursOf(e).toFixed(2)} h` : ''}
                      </span>
                      {(() => { const p = punctuality(e); return p ? <Badge className={`text-[10px] border-0 ${p.cls}`}>{p.label}</Badge> : null; })()}
                      {e.autoClosed && (
                        <Badge
                          className="text-[10px] border-0 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                          title="No clock-out was recorded — this end time is an estimate. Verify and correct it."
                        >
                          auto-closed
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px] uppercase">{e.method}</Badge>
                      <StatusBadge e={e} />
                      {e.editedBy && (
                        <span title={e.editNote || 'Edited by a manager'}>
                          <Pencil className="w-3 h-3 text-amber-500" />
                        </span>
                      )}
                      {/* approve: a clean punch is one tap; a member's counter-proposal
                          shows what they're asking for before you accept it */}
                      {e.clockOut && (e.status === 'pending_manager' || !e.status) && (
                        <Button
                          size="sm" variant="outline"
                          className="h-6 gap-1 text-[11px] px-2"
                          disabled={approve.isPending}
                          title={e.proposedAt ? 'Accept the times they proposed' : 'Verify these hours'}
                          onClick={() => approve.mutate(e)}
                        >
                          <Check className="w-3 h-3" />
                          {e.proposedAt ? 'Accept' : 'Approve'}
                        </Button>
                      )}
                      {e.status === 'pending_member' && (
                        <Button
                          size="sm" variant="ghost"
                          className="h-6 gap-1 text-[11px] px-2 text-muted-foreground"
                          disabled={remind.isPending}
                          title="Send them a reminder now"
                          onClick={() => remind.mutate(e.id)}
                        >
                          <Bell className="w-3 h-3" /> Remind
                        </Button>
                      )}
                      {(e.clockInPhoto || e.clockOutPhoto) && (
                        <button
                          className="text-muted-foreground hover:text-foreground"
                          title="View punch photo"
                          onClick={() => viewPhoto(e.clockInPhoto || e.clockOutPhoto)}
                        >
                          <Camera className="w-4 h-4" />
                        </button>
                      )}
                      <Button
                        size="icon" variant="ghost" className="h-6 w-6"
                        onClick={() => {
                          setEditEntry(e);
                          setEditForm({ clockIn: fmtDT(e.clockIn), clockOut: e.clockOut ? fmtDT(e.clockOut) : '', editNote: e.editNote || '' });
                        }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* edit entry */}
      <Dialog open={!!editEntry} onOpenChange={() => setEditEntry(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit Time Entry</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Clock In</Label>
              <Input type="datetime-local" value={editForm.clockIn || ''} onChange={e => setEditForm(f => ({ ...f, clockIn: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Clock Out (blank = still on the clock)</Label>
              <Input type="datetime-local" value={editForm.clockOut || ''} onChange={e => setEditForm(f => ({ ...f, clockOut: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Correction Note</Label>
              <Textarea rows={2} value={editForm.editNote || ''} onChange={e => setEditForm(f => ({ ...f, editNote: e.target.value }))} placeholder="e.g., forgot to clock out" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEntry(null)}>Cancel</Button>
            <Button onClick={() => saveEdit.mutate()} disabled={saveEdit.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* punch photo */}
      <Dialog open={!!photoUrl} onOpenChange={() => setPhotoUrl(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Punch Photo</DialogTitle></DialogHeader>
          {photoUrl && <img src={photoUrl} alt="Punch" className="w-full rounded-lg" />}
        </DialogContent>
      </Dialog>

      {/* export confirm */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Export for Paylocity</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              Exports <span className="font-medium">{verifiedExportable.length}</span> verified
              entries ({rangeStart} → {rangeEnd}) as a Universal Time Import CSV — no headers, 24 columns,
              earnings code <span className="font-mono">{sanitize(detcode) || 'REG'}</span>. Upload it directly in Paylocity.
            </p>
            {unverified.length > 0 && (
              <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3">
                <p className="flex gap-2 text-amber-700 dark:text-amber-400 font-medium">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  {unverified.length} timesheet{unverified.length === 1 ? '' : 's'} still need approval and won't be included.
                </p>
                {/* names, not a count — a bare number doesn't tell you whose pay is short */}
                <ul className="mt-2 space-y-0.5 text-[13px] max-h-40 overflow-y-auto">
                  {unverifiedPeople.map(p => (
                    <li key={p.id} className="flex items-center justify-between gap-3">
                      <span>{nameOf(p.id)}</span>
                      <span className="text-muted-foreground text-[11px]">
                        {p.count} {p.count === 1 ? 'entry' : 'entries'} · {p.waitingOnMember ? 'with them' : 'needs your approval'}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  They'll export on the next run once approved — or approve them now and re-export.
                </p>
              </div>
            )}
            {openEntries.length > 0 && (
              <p className="flex gap-2 text-amber-600"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                {openEntries.length} entr{openEntries.length === 1 ? 'y is' : 'ies are'} still open (no clock-out) and will be skipped.
              </p>
            )}
            {alreadyExported > 0 && (
              <p className="flex gap-2 text-sky-600"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                {alreadyExported} of these were already exported — running this again will send them a second time.
              </p>
            )}
            {missingBadge.length > 0 && (
              <p className="flex gap-2 text-red-600"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                Skipped — no badge #: {missingBadge.map(nameOf).join(', ')}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>Cancel</Button>
            <Button onClick={exportCsv} className="gap-1.5"><Download className="w-4 h-4" /> Download CSV</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
