import React, { useEffect, useMemo, useState } from 'react';
import { useTeamMembers } from '@/lib/useAppData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import TeamMemberCombobox from '@/components/common/TeamMemberCombobox';
import { ShieldOff, Volume2, VolumeX } from 'lucide-react';
import { format } from 'date-fns';

// The one place to see and change every messaging mute an admin can manage.
// A mute applies everywhere in Messages (DMs, groups, role channels). The
// list comes from RLS (mutes at my clubs; corporate+ sees all); the server
// decides who I may mute or unmute (never myself, only people ranked below me).
export default function MutedMembersDialog({ open, onClose, mutes, myId, outranks, onToggleMute }) {
  const { data: members = [] } = useTeamMembers();
  const [pick, setPick] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setPick(''); setReason(''); } }, [open]);

  const byId = useMemo(() => Object.fromEntries(members.map(m => [m.id, m])), [members]);
  const nameOf = (id) => { const m = byId[id]; return m ? `${m.preferredName || m.firstName} ${m.lastName}` : 'Unknown'; };
  const mutedIds = new Set(mutes.map(m => m.team_member_id));

  // who I can mute: active, not me, not already muted, ranked below me
  const candidates = useMemo(
    () => members.filter(m => m.status === 'active' && m.id !== myId && !mutedIds.has(m.id) && outranks(m.permissionLevel)),
    [members, myId, mutes, outranks]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (id, muted, why) => {
    setBusy(true);
    try { await onToggleMute(id, muted, why); if (muted) { setPick(''); setReason(''); } }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2"><ShieldOff className="w-4 h-4" /> Muted members</DialogTitle>
          <DialogDescription>
            A muted member can read every conversation but can’t post anywhere until an admin unmutes them.
            You can only mute people ranked below you, and never yourself.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 pb-3 border-b border-border">
          <Label className="text-xs">Mute someone</Label>
          <TeamMemberCombobox value={pick} onChange={setPick} eligibleTeamMembers={candidates} placeholder="Search team member…" />
          <div className="flex gap-2">
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (optional, shown to them)" className="h-9" />
            <Button size="sm" variant="destructive" className="h-9 gap-1.5 shrink-0" disabled={!pick || busy} onClick={() => act(pick, true, reason)}>
              <VolumeX className="w-3.5 h-3.5" /> Mute
            </Button>
          </div>
        </div>

        <div>
          <Label className="text-xs">{mutes.length ? `${mutes.length} currently muted` : 'Nobody is muted'}</Label>
          {mutes.length > 0 && (
            <div className="max-h-72 overflow-y-auto border border-border rounded-md mt-1">
              {mutes.map(m => {
                const canLift = m.team_member_id !== myId && outranks(byId[m.team_member_id]?.permissionLevel);
                return (
                  <div key={m.team_member_id} className="flex items-start gap-2 px-2.5 py-2 text-sm border-b border-border/50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{nameOf(m.team_member_id)}{m.team_member_id === myId ? ' (you)' : ''}</p>
                      <p className="text-[11px] text-muted-foreground">
                        muted by {nameOf(m.muted_by)} · {format(new Date(m.muted_at), 'MMM d, h:mm a')}
                        {m.reason ? <> · <span className="italic">“{m.reason}”</span></> : null}
                      </p>
                    </div>
                    {canLift ? (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1 shrink-0" disabled={busy} onClick={() => act(m.team_member_id, false)}>
                        <Volume2 className="w-3 h-3" /> Unmute
                      </Button>
                    ) : (
                      <span className="text-[10px] text-muted-foreground shrink-0 mt-1">needs a higher admin</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
