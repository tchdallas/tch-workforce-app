import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { postPolicyUpdate } from '@/lib/policies';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Megaphone } from 'lucide-react';
import { toast } from 'sonner';

// The five things managers actually post against a live procedure. They're
// labels, not permissions — but naming them keeps a long thread scannable
// ("what changed" vs "here's an example from last night").
export const UPDATE_KINDS = [
  { value: 'update', label: 'Update', hint: 'The procedure itself has changed.' },
  { value: 'addendum', label: 'Addendum', hint: 'Something new added to the policy.' },
  { value: 'clarification', label: 'Clarification', hint: 'Same rule, said more clearly.' },
  { value: 'example', label: 'Example', hint: 'A real situation and how it was handled.' },
  { value: 'reminder', label: 'Reminder', hint: 'No change — just resurfacing it.' },
];

export default function PolicyUpdateDialog({ open, onClose, policyId }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState('update');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [requiresAck, setRequiresAck] = useState(false);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (open) { setKind('update'); setTitle(''); setBody(''); setRequiresAck(false); }
  }, [open]);

  const hint = UPDATE_KINDS.find(k => k.value === kind)?.hint;
  const valid = title.trim() && body.trim();

  const post = async () => {
    setPosting(true);
    try {
      await postPolicyUpdate({ policyId, kind, title, body, requiresAcknowledgment: requiresAck });
      qc.invalidateQueries({ queryKey: ['policy-updates', policyId] });
      qc.invalidateQueries({ queryKey: ['policy-my-acks', policyId] });
      toast.success('Posted to the team');
      onClose();
    } catch (e) {
      toast.error(
        e.message?.includes('do not manage') ? 'You can only post to clubs you manage.'
          : e.message?.includes('publish the policy') ? 'Publish the policy before posting updates to it.'
          : (e.message || 'Could not post')
      );
    } finally { setPosting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Megaphone className="w-4 h-4" /> Post an update
          </DialogTitle>
          <DialogDescription>
            Goes to everyone this policy applies to, and lands at the top of its history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {UPDATE_KINDS.map(k => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
          </div>
          <div>
            <Label className="text-xs">Headline</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Straddle now allowed under the gun only" />
          </div>
          <div>
            <Label className="text-xs">Details</Label>
            <Textarea value={body} onChange={e => setBody(e.target.value)} rows={5} placeholder="What changed, and what should the team do differently?" />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div className="pr-3">
              <p className="text-sm font-medium">Require acknowledgment</p>
              <p className="text-[11px] text-muted-foreground">Use this for real rule changes, not reminders.</p>
            </div>
            <Switch checked={requiresAck} onCheckedChange={setRequiresAck} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={posting}>Cancel</Button>
          <Button disabled={!valid || posting} onClick={post}>{posting ? 'Posting…' : 'Post to team'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
