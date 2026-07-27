import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { memberAccept, memberCounter } from '@/lib/timesheets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Check, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const fmtDT = (d) => (d ? format(new Date(d), "yyyy-MM-dd'T'HH:mm") : '');

// What a team member sees when a manager has filled in times they didn't punch.
// Two ways out: accept what's proposed, or say what actually happened — which
// goes back to the manager rather than straight into payroll.
export default function ConfirmHoursDialog({ entry, memberId, onClose }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState('review'); // 'review' | 'counter'
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!entry) return;
    setMode('review');
    setClockIn(fmtDT(entry.proposed_clock_in || entry.clock_in));
    setClockOut(fmtDT(entry.proposed_clock_out || entry.clock_out));
    setNote('');
  }, [entry]);

  if (!entry) return null;

  const inAt = entry.proposed_clock_in || entry.clock_in;
  const outAt = entry.proposed_clock_out || entry.clock_out;

  const done = (msg) => {
    qc.invalidateQueries({ queryKey: ['my-pending-time-entries', memberId] });
    qc.invalidateQueries({ queryKey: ['my-time-entries', memberId] });
    qc.invalidateQueries({ queryKey: ['time-entries'] });
    toast.success(msg);
    onClose();
  };

  const accept = async () => {
    setBusy(true);
    try { await memberAccept(entry.id); done('Hours confirmed'); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const counter = async () => {
    setBusy(true);
    try {
      await memberCounter(entry.id, clockIn, clockOut || null, note);
      done('Sent to your manager to review');
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={!!entry} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" /> Confirm your hours
          </DialogTitle>
          <DialogDescription>
            {entry.manager_created
              ? "There was no punch for this shift, so a manager entered it."
              : "A manager adjusted the times recorded for this shift."}
          </DialogDescription>
        </DialogHeader>

        {mode === 'review' ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border p-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Proposed</p>
              <p className="text-sm font-medium">
                {format(new Date(inAt), 'EEEE, MMM d')}
              </p>
              <p className="text-sm tabular-nums mt-0.5">
                {format(new Date(inAt), 'h:mm a')} – {outAt ? format(new Date(outAt), 'h:mm a') : '—'}
                {outAt && (
                  <span className="text-muted-foreground ml-2">
                    ({((new Date(outAt) - new Date(inAt)) / 3600000).toFixed(2)} h)
                  </span>
                )}
              </p>
            </div>
            {entry.proposal_note && (
              <p className="text-xs text-muted-foreground italic">"{entry.proposal_note}"</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              These are the hours you'll be paid for. Confirm only if they look right.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">When you actually started</Label>
              <Input type="datetime-local" value={clockIn} onChange={e => setClockIn(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">When you actually finished</Label>
              <Input type="datetime-local" value={clockOut} onChange={e => setClockOut(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">What happened</Label>
              <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)}
                placeholder="e.g. I stayed until close covering the 2 table" />
            </div>
            <p className="text-[11px] text-muted-foreground">
              This goes back to your manager to approve — it isn't applied on its own.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {mode === 'review' ? (
            <>
              <Button variant="outline" onClick={() => setMode('counter')} disabled={busy}>
                That's not right
              </Button>
              <Button onClick={accept} disabled={busy} className="gap-1.5">
                <Check className="w-4 h-4" /> {busy ? 'Saving…' : 'Confirm'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setMode('review')} disabled={busy}>Back</Button>
              <Button onClick={counter} disabled={busy || !clockIn}>
                {busy ? 'Sending…' : 'Send to manager'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
