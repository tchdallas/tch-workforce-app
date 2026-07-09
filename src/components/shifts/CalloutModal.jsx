import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { formatEndTime } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Clock, MapPin, Shield } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const REASONS = ['Sick', 'Family emergency', 'Transportation issue', 'Other'];

export default function CalloutModal({ open, onClose, shift, role, location, currentMemberId }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');

  const submitMutation = useMutation({
    mutationFn: () =>
      base44.entities.Callout.create({
        shiftId: shift.id,
        teamMemberId: currentMemberId,
        locationId: shift.locationId,
        roleId: shift.roleId,
        reason,
        note: note.trim() || undefined,
        status: 'submitted',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['callouts'] });
      toast.success('Callout submitted — your manager has been notified.');
      handleClose();
    },
    onError: (e) => toast.error(e.message || 'Could not submit callout'),
  });

  const handleClose = () => {
    setReason('');
    setNote('');
    onClose();
  };

  if (!shift) return null;

  const roleColor = role?.color || '#6366f1';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" /> Call Out of Shift
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border-l-4" style={{ borderLeftColor: roleColor }}>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-1.5">
              <Shield className="w-3 h-3 text-muted-foreground" />
              <span className="text-sm font-semibold">{role?.name || '—'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{location?.name || '—'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {format(new Date(shift.startDateTime), 'EEE, MMM d · h:mm a')} – {formatEndTime(shift.startDateTime, shift.endDateTime)}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger>
              <SelectContent>
                {REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Note (optional)</Label>
            <Textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Anything your manager should know"
              rows={2}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Your manager will be notified right away and will handle coverage for this shift.
            If you're currently clocked in for it, you'll be clocked out automatically.
          </p>
        </div>

        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={handleClose}>Cancel</Button>
          <Button
            variant="destructive"
            className="flex-1"
            disabled={!reason || submitMutation.isPending}
            onClick={() => submitMutation.mutate()}
          >
            {submitMutation.isPending ? 'Submitting…' : 'Call Out'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
