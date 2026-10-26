import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useTeamMembers } from '@/lib/useAppData';
import { format, startOfWeek, addDays, differenceInCalendarDays } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CalendarIcon, Copy, Loader2, History, PencilRuler } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// Copy a past week's schedule into another week, as drafts to review+publish.
// Two flavors:
//  - 'original'  = the schedule as the manager designed it: accepted swaps,
//    giveaways and open-shift pickups are undone (back to the original
//    assignee / back to open), and shifts cancelled after publishing return.
//  - 'current'   = the week exactly as it ended up (cancelled shifts stay gone).
// The "original assignee" comes from the request tables themselves — each
// accepted giveaway/trade/claim records who held the shift before it moved.

const weekLabel = (ws) => `${format(ws, 'MMM d')} – ${format(addDays(ws, 6), 'MMM d, yyyy')}`;
const snapWeek = (v) => startOfWeek(new Date(`${v}T00:00:00`), { weekStartsOn: 0 });

export default function CopyWeekDialog({ open, onClose, weekStart, selectedLocation, onCopied }) {
  const [sourceWeek, setSourceWeek] = useState(addDays(weekStart, -7));
  const [targetWeek, setTargetWeek] = useState(weekStart);
  const [mode, setMode] = useState('original');
  const [copying, setCopying] = useState(false);

  // re-seed when (re)opened from a different viewed week
  useEffect(() => {
    if (!open) return;
    setSourceWeek(addDays(weekStart, -7));
    setTargetWeek(weekStart);
    setMode('original');
  }, [open, weekStart]);

  const { data: teamMembers = [] } = useTeamMembers();

  const srcStr = format(sourceWeek, "yyyy-MM-dd'T'HH:mm:ss");
  const srcEndStr = format(addDays(sourceWeek, 7), "yyyy-MM-dd'T'HH:mm:ss");

  // the source week's shifts + every accepted transfer that touched them
  const { data: source, isFetching } = useQuery({
    queryKey: ['copy-week-source', srcStr, selectedLocation],
    enabled: open,
    queryFn: async () => {
      const filter = {
        startDateTime: { $gte: srcStr, $lt: srcEndStr },
        archived: { $ne: true },
      };
      if (selectedLocation && selectedLocation !== 'all') filter.locationId = selectedLocation;
      const PAGE = 500;
      let shifts = [];
      let page = 0;
      while (true) {
        const batch = await base44.entities.Shift.filter(filter, 'startDateTime', PAGE, page * PAGE);
        shifts = shifts.concat(batch);
        if (batch.length < PAGE) break;
        page++;
      }
      const ids = shifts.map(s => s.id);
      if (ids.length === 0) return { shifts, originalOwner: {}, revertCount: 0 };

      const [giveaways, tradesA, tradesB, claims] = await Promise.all([
        base44.entities.ShiftGiveawayRequest.filter({ shiftId: { $in: ids }, status: { $in: ['accepted', 'approved'] } }),
        base44.entities.ShiftTradeRequest.filter({ originalShiftId: { $in: ids }, status: 'approved' }),
        base44.entities.ShiftTradeRequest.filter({ requestedShiftId: { $in: ids }, status: 'approved' }),
        base44.entities.OpenShiftClaim.filter({ shiftId: { $in: ids }, status: 'approved' }),
      ]);

      // who held each shift BEFORE its first transfer (earliest event wins)
      const events = [];
      giveaways.forEach(g => events.push({ shiftId: g.shiftId, owner: g.originalTeamMemberId, at: g.created_date }));
      tradesA.forEach(t => events.push({ shiftId: t.originalShiftId, owner: t.requestingTeamMemberId, at: t.created_date }));
      tradesB.forEach(t => events.push({ shiftId: t.requestedShiftId, owner: t.targetTeamMemberId, at: t.created_date }));
      claims.forEach(c => events.push({ shiftId: c.shiftId, owner: null, at: c.created_date })); // was an open shift
      events.sort((a, b) => new Date(a.at) - new Date(b.at));
      const originalOwner = {};
      for (const e of events) if (!(e.shiftId in originalOwner)) originalOwner[e.shiftId] = e.owner;

      return { shifts, originalOwner, revertCount: Object.keys(originalOwner).length };
    },
  });

  const shifts = source?.shifts || [];
  const cancelledCount = shifts.filter(s => s.status === 'cancelled').length;
  const toCopy = mode === 'original' ? shifts : shifts.filter(s => s.status !== 'cancelled');
  const dayOffset = differenceInCalendarDays(targetWeek, sourceWeek);

  const handleCopy = async () => {
    if (toCopy.length === 0) return toast.error('No shifts found in that week to copy');
    if (dayOffset === 0) return toast.error('Pick a different week to copy into');
    setCopying(true);
    try {
      const activeIds = new Set(teamMembers.filter(m => m.status !== 'archived').map(m => m.id));
      let unassigned = 0;
      const rows = toCopy.map(s => {
        let memberId = s.teamMemberId || null;
        if (mode === 'original' && s.id in (source?.originalOwner || {})) {
          memberId = source.originalOwner[s.id]; // undo the transfer (null = was open)
        }
        if (memberId && !activeIds.has(memberId)) { memberId = null; unassigned++; } // person no longer here
        return {
          locationId: s.locationId,
          roleId: s.roleId,
          teamMemberId: memberId,
          startDateTime: addDays(new Date(s.startDateTime), dayOffset).toISOString(),
          endDateTime: addDays(new Date(s.endDateTime), dayOffset).toISOString(),
          breakMinutes: s.breakMinutes || 0,
          breakNote: s.breakNote || null,
          teamFacingNotes: s.teamFacingNotes || null,
          internalNotes: s.internalNotes || null,
          status: 'draft',
          shiftType: memberId ? 'assigned' : 'open',
          coverageStatus: memberId ? 'covered' : 'open',
        };
      });
      await base44.entities.Shift.bulkCreate(rows);
      const notes = [];
      if (mode === 'original' && source?.revertCount) notes.push(`${source.revertCount} returned to the original person`);
      if (unassigned) notes.push(`${unassigned} left open (person no longer on the roster)`);
      toast.success(`Copied ${rows.length} shift${rows.length === 1 ? '' : 's'} into the week of ${format(targetWeek, 'MMM d')} as drafts${notes.length ? ` — ${notes.join(', ')}` : ''}`);
      onCopied(targetWeek);
    } catch (err) {
      const msg = /row-level security|has_location_access/i.test(err?.message || '')
        ? "You don't have access to that location's schedule."
        : (err?.message || 'Could not copy the week.');
      toast.error(msg);
    } finally {
      setCopying(false);
    }
  };

  const handleClose = () => { if (!copying) onClose(); };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Copy className="w-4 h-4" /> Copy a Week</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Copy from</Label>
              <Input type="date" value={format(sourceWeek, 'yyyy-MM-dd')}
                onChange={e => e.target.value && setSourceWeek(snapWeek(e.target.value))} />
              <p className="text-[11px] text-muted-foreground mt-1">{weekLabel(sourceWeek)}</p>
            </div>
            <div>
              <Label className="text-xs">Paste into</Label>
              <Input type="date" value={format(targetWeek, 'yyyy-MM-dd')}
                onChange={e => e.target.value && setTargetWeek(snapWeek(e.target.value))} />
              <p className="text-[11px] text-muted-foreground mt-1">{weekLabel(targetWeek)}</p>
            </div>
          </div>

          <div>
            <Label className="text-xs">What to copy</Label>
            <div className="grid gap-2 mt-1">
              {[
                {
                  v: 'original', icon: PencilRuler, title: 'The original schedule',
                  desc: 'As it was designed — swaps, giveaways and pickups are undone, and shifts cancelled after publishing come back.',
                },
                {
                  v: 'current', icon: History, title: 'As it actually ran',
                  desc: 'The week exactly as it ended up, including every swap and change. Cancelled shifts stay out.',
                },
              ].map(opt => (
                <button key={opt.v} type="button" onClick={() => setMode(opt.v)}
                  className={cn('text-left rounded-lg border p-3 transition-colors',
                    mode === opt.v ? 'border-primary bg-primary/5' : 'border-input hover:bg-accent/10')}>
                  <p className="text-sm font-medium flex items-center gap-1.5"><opt.icon className="w-3.5 h-3.5" /> {opt.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
            <CalendarIcon className="w-4 h-4 flex-shrink-0" />
            {isFetching ? <span>Looking at that week…</span> : (
              <span>
                <Badge variant="outline" className="text-xs mr-1.5">{toCopy.length}</Badge>
                shift{toCopy.length === 1 ? '' : 's'} to copy
                {mode === 'original' && source?.revertCount ? ` · ${source.revertCount} will go back to the original person` : ''}
                {mode === 'original' && cancelledCount ? ` · ${cancelledCount} cancelled shift${cancelledCount === 1 ? '' : 's'} restored` : ''}
              </span>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Everything arrives as <span className="font-medium text-foreground">drafts</span> — review, adjust, then publish.
            {(!selectedLocation || selectedLocation === 'all') && ' Copies every location you can see.'}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={copying}>Cancel</Button>
          <Button onClick={handleCopy} disabled={copying || isFetching || toCopy.length === 0}>
            {copying ? <><Loader2 className="w-4 h-4 animate-spin" /> Copying…</> : `Copy ${toCopy.length || ''} Shift${toCopy.length === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
