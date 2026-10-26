import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Trash2, Ban, Loader2 } from 'lucide-react';

// Removing a shift always requires a reason (it's kept in the shift's history).
// Drafts are truly deleted; published shifts are CANCELLED instead — the
// database forbids hard-deleting them so the record survives — and the
// assigned member is notified. Both disappear from the builder grid.
export default function RemoveShiftDialog({ ids, shifts, busy, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (ids) setReason(''); }, [ids]);
  if (!ids || !ids.length) return null;

  const targets = shifts.filter(s => ids.includes(s.id));
  const drafts = targets.filter(s => s.status === 'draft');
  const published = targets.filter(s => s.status !== 'draft');

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Remove {targets.length === 1 ? 'this shift' : `${targets.length} shifts`}?</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1 text-sm">
              {drafts.length > 0 && (
                <p className="flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5 shrink-0" />
                  {drafts.length} draft{drafts.length === 1 ? '' : 's'} will be deleted.</p>
              )}
              {published.length > 0 && (
                <p className="flex items-center gap-1.5"><Ban className="w-3.5 h-3.5 shrink-0" />
                  {published.length} published shift{published.length === 1 ? '' : 's'} will be <b>cancelled</b> — assigned
                  team members are notified, and the record stays in the shift history.</p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label className="text-xs">Reason (required — saved to the shift history)</Label>
          <Textarea rows={2} autoFocus value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. duplicate shift, business level dropped, scheduled in error" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Keep shift{targets.length === 1 ? '' : 's'}</Button>
          <Button variant="destructive" disabled={!reason.trim() || busy} onClick={() => onConfirm(reason.trim())}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : `Remove ${targets.length === 1 ? 'shift' : targets.length + ' shifts'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
