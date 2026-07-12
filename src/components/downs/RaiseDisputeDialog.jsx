import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

// A dealer flags a problem with their tournament downs (a wrong card, a missing
// down, etc.). Managers at the location get notified and can resolve it.
export default function RaiseDisputeDialog({ open, onClose, memberId, locationId }) {
  const qc = useQueryClient();
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setMessage(''); }, [open]);

  const submit = async () => {
    if (!message.trim()) return toast.error('Please describe the problem');
    setSaving(true);
    try {
      await base44.entities.DownDispute.create({
        teamMemberId: memberId,
        locationId: locationId || null,
        message: message.trim(),
      });
      toast.success('Submitted — a manager will review it');
      qc.invalidateQueries({ queryKey: ['my-disputes', memberId] });
      qc.invalidateQueries({ queryKey: ['open-disputes'] });
      onClose();
    } catch (e) {
      toast.error(e.message || 'Could not submit');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-base">Report a downs problem</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label className="text-xs">What's wrong?</Label>
          <Textarea
            rows={4}
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="e.g. I'm missing a down from the 7/12 tournament at table 5"
          />
          <p className="text-[11px] text-muted-foreground">
            Tip: report within 24 hours of a pay period closing. Include the tournament, date, and table if you can.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={!message.trim() || saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
