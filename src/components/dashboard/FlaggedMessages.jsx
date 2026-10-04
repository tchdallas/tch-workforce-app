import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { useRoles, useLocations } from '@/lib/useAppData';
import { useOpenFlags, resolveFlag, softDeleteMessage, setMessagingMute } from '@/lib/messaging';
import { Button } from '@/components/ui/button';
import { Flag, ExternalLink, Trash2, VolumeX, Check } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

// Flagged-message review queue inside "Needs Your Attention". Only admins who
// moderate the conversation see a flag (RLS). Each one resolves with:
//   Dismiss              — nothing wrong, close the flag
//   Remove message       — soft-delete the message, close the flag
//   Remove & mute sender — also stop the sender posting anywhere in Messages
// Reviewing here needs no trip into the thread (the admin may not be in it).

export function useFlagInboxCount() {
  const { isAdmin } = useCurrentMember();
  const { data = [] } = useOpenFlags(isAdmin);
  return isAdmin ? data.length : 0;
}

export default function FlaggedMessages() {
  const qc = useQueryClient();
  const { member, isAdmin, outranks } = useCurrentMember();
  const { data: allFlags = [] } = useOpenFlags(isAdmin);
  // the server already hides flags on my own messages; this is belt-and-braces
  const flags = useMemo(() => allFlags.filter(f => f.messages?.sender_team_member_id !== member?.id), [allFlags, member?.id]);
  const { data: roles = [] } = useRoles();
  const { data: locations = [] } = useLocations();
  const [busyId, setBusyId] = useState(null);

  // names for senders + flaggers (admins can read these rows; one query for all)
  const peopleIds = useMemo(() => [...new Set(
    flags.flatMap(f => [f.flagged_by, f.messages?.sender_team_member_id]).filter(Boolean)
  )].sort(), [flags]);
  const { data: people = [] } = useQuery({
    queryKey: ['team-member-names', peopleIds.join(',')],
    enabled: peopleIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: () => base44.entities.TeamMember.filter({ id: { $in: peopleIds } }),
    placeholderData: [],
  });
  const levelOf = (id) => people.find(x => x.id === id)?.permissionLevel;
  const nameOf = (id) => {
    const p = people.find(x => x.id === id);
    return p ? `${p.preferredName || p.firstName} ${p.lastName}` : 'a team member';
  };
  const convName = (c) => {
    if (!c) return 'a conversation';
    if (c.conversation_type === 'direct') return 'a direct message';
    const club = locations.find(l => l.id === c.location_id);
    if (c.conversation_type === 'role_group') {
      const r = roles.find(x => x.id === c.role_id);
      return `${r?.name || 'Role'}${club ? ` · ${club.abbreviation || club.name}` : ''}`;
    }
    return c.title || 'Group';
  };

  if (!isAdmin || flags.length === 0) return null;

  const act = async (flag, status) => {
    setBusyId(flag.id);
    try {
      if (status === 'removed' || status === 'muted') {
        if (!flag.messages?.deleted_at) await softDeleteMessage(flag.message_id, member.id);
      }
      if (status === 'muted') {
        await setMessagingMute(flag.messages.sender_team_member_id, true,
          `Flagged message removed by ${member.preferredName || member.firstName} ${member.lastName}`);
        qc.invalidateQueries({ queryKey: ['messaging-mutes'] });
      }
      await resolveFlag(flag.id, status, member.id);
      qc.invalidateQueries({ queryKey: ['message-flags'] });
      qc.invalidateQueries({ queryKey: ['messages', flag.conversation_id] });
      toast.success(status === 'dismissed' ? 'Flag dismissed'
        : status === 'removed' ? 'Message removed'
        : `Message removed and ${nameOf(flag.messages.sender_team_member_id)} muted everywhere`);
    } catch (e) {
      toast.error(e.message || 'Could not resolve the flag');
    } finally { setBusyId(null); }
  };

  return (
    <>
      {flags.map(f => {
        const msg = f.messages;
        const busy = busyId === f.id;
        // same hierarchy as discipline: you only mute people ranked below you
        const canMuteSender = !!msg && outranks(levelOf(msg.sender_team_member_id));
        return (
          <div key={f.id} className="p-3 rounded-lg border border-amber-300 dark:border-amber-700 space-y-2">
            <div className="flex items-start gap-3">
              <Flag className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Flagged message in {convName(f.conversations)}</p>
                <p className="text-xs text-muted-foreground">
                  {nameOf(f.flagged_by)} flagged {nameOf(msg?.sender_team_member_id)} · {format(new Date(f.created_at), 'MMM d, h:mm a')}
                  {f.reason ? <> · <span className="italic">“{f.reason}”</span></> : null}
                </p>
              </div>
              <Link to={`/messages?c=${f.conversation_id}`} className="text-muted-foreground hover:text-foreground shrink-0" title="Open the thread">
                <ExternalLink className="w-4 h-4" />
              </Link>
            </div>
            <blockquote className="text-sm border-l-2 border-amber-300 dark:border-amber-700 pl-3 ml-7 whitespace-pre-wrap break-words">
              {msg?.deleted_at ? <span className="italic text-muted-foreground">Message already removed</span> : msg?.body}
            </blockquote>
            <div className="flex flex-wrap gap-1.5 ml-7">
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={busy} onClick={() => act(f, 'dismissed')}>
                <Check className="w-3 h-3" /> Dismiss
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={busy || !!msg?.deleted_at} onClick={() => act(f, 'removed')}>
                <Trash2 className="w-3 h-3" /> Remove message
              </Button>
              {canMuteSender && (
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive border-destructive/40" disabled={busy} onClick={() => act(f, 'muted')}>
                  <VolumeX className="w-3 h-3" /> Remove &amp; mute sender
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
