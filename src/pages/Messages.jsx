import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabase';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { useRoles, useLocations } from '@/lib/useAppData';
import {
  useMyConversations, useMessages, useMyBlocks, useMessagingDirectory, useConversationParticipants, useMessagingMutes,
  sendMessage, markRead, setMuted, setMessagingMute, startDM, createGroup, updateGroup, addParticipants,
  removeParticipant, blockMember, softDeleteMessage, flagMessage,
} from '@/lib/messaging';
import PageHeader from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import TeamMemberCombobox from '@/components/common/TeamMemberCombobox';
import MutedMembersDialog from '@/components/messaging/MutedMembersDialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  MessageSquare, Plus, Users, Send, ChevronLeft, MoreVertical, Bell, BellOff, Ban, Hash, Trash2,
  AtSign, Flag, Settings2, VolumeX, Volume2, UserMinus, UserPlus, ShieldAlert, Building2, ShieldOff, ArrowLeftRight,
} from 'lucide-react';
import { format, isSameDay } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const NO_CLUB = '__none__';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Turn a Postgres/RLS failure into something a dealer can act on.
function sendErrorMessage(e, { silenced, broadcast }) {
  const msg = e?.message || '';
  if (/row-level security|policy/i.test(msg)) {
    if (silenced) return 'An admin has muted your messaging. You can read but not post.';
    if (broadcast) return 'Only managers and above can @ a role or @All here.';
    return "You can't post in this conversation.";
  }
  return msg || 'Could not send';
}

export default function Messages() {
  const qc = useQueryClient();
  const { member, isManager, isAdmin, canSeeAllLocations, assignedLocationIds, scopeLocations, outranks } = useCurrentMember();
  const myId = member?.id;
  const canBroadcast = !!member && isManager; // strict: no flash of @All for dealers while loading
  const { data: directory = [] } = useMessagingDirectory(myId);
  const { data: roles = [] } = useRoles();
  const { data: locations = [] } = useLocations();
  const { data: conversations = [] } = useMyConversations(myId);
  const { data: myBlocks = [] } = useMyBlocks(myId);
  const { data: mutes = [] } = useMessagingMutes(myId);
  const amMuted = mutes.some(m => m.team_member_id === myId);
  const mutedIds = useMemo(() => new Set(mutes.map(m => m.team_member_id)), [mutes]);

  const [selectedId, setSelectedId] = useState(null);
  const { data: messages = [] } = useMessages(selectedId);
  const selected = conversations.find(c => c.id === selectedId);

  // deep link: /messages?c=<conversationId> (notification click-throughs)
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const c = searchParams.get('c');
    if (!c || !conversations.length) return;
    if (conversations.some(x => x.id === c)) setSelectedId(c);
    setSearchParams({}, { replace: true }); // one-shot: don't re-select on back-nav
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, conversations.length]);

  const [newDmOpen, setNewDmOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [mutesOpen, setMutesOpen] = useState(false);
  const [flagTarget, setFlagTarget] = useState(null); // message being flagged
  const [flagReason, setFlagReason] = useState('');
  const [draft, setDraft] = useState('');
  const [pendingMentions, setPendingMentions] = useState([]); // mentions picked for this draft
  const [mentionQuery, setMentionQuery] = useState(null);     // null = picker closed
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const memberById = useMemo(() => Object.fromEntries(directory.map(m => [m.id, m])), [directory]);
  const nameOf = (id) => { const m = memberById[id]; return m ? `${m.preferredName || m.firstName} ${m.lastName}` : 'Unknown'; };
  const initials = (id) => nameOf(id).split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const clubName = (id) => { const l = locations.find(x => x.id === id); return l?.abbreviation || l?.name || null; };

  const convName = (c) => {
    if (!c) return '';
    if (c.conversation_type === 'direct') return c.otherMemberIds.length ? nameOf(c.otherMemberIds[0]) : 'Direct message';
    if (c.conversation_type === 'role_group') {
      const r = roles.find(x => x.id === c.role_id);
      return `${r?.name || 'Role'}${clubName(c.location_id) ? ` · ${clubName(c.location_id)}` : ''}`;
    }
    return c.title || 'Group';
  };

  // Admin moderation is club-scoped: corporate+ everywhere, location_admin at
  // their own clubs (a group with no club falls back to the server's
  // shared-location test — we let the button show and the DB has final say).
  const canModerate = (c) => !!c && isAdmin &&
    (canSeeAllLocations || !c.location_id || assignedLocationIds.includes(c.location_id));
  const canMod = canModerate(selected);

  // people I can DM: the directory already limits to coworkers sharing a
  // location (can_dm); just drop anyone I've blocked.
  const dmCandidates = useMemo(
    () => directory.filter(m => m.canDm && !myBlocks.includes(m.id)),
    [directory, myBlocks]);

  const myClubs = useMemo(() => scopeLocations(locations.filter(l => l.status !== 'archived')), [locations, scopeLocations]);

  // realtime: live-refresh the open thread + the conversation list on new messages
  useEffect(() => {
    if (!selectedId || !myId) return;
    let channel; let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || cancelled) return;
      supabase.realtime.setAuth(session.access_token);
      channel = supabase.channel(`messages-${selectedId}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${selectedId}` },
          () => {
            qc.invalidateQueries({ queryKey: ['messages', selectedId] });
            qc.invalidateQueries({ queryKey: ['conversations', myId] });
          })
        .subscribe();
    })();
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [selectedId, myId, qc]);

  // mark read when opening a conversation
  useEffect(() => {
    if (!selectedId || !myId) return;
    markRead(selectedId, myId).then(() => {
      qc.invalidateQueries({ queryKey: ['conversations', myId] });
      qc.invalidateQueries({ queryKey: ['unread-messages'] }); // clear the nav bubble
    });
  }, [selectedId, myId, messages.length]); // eslint-disable-line

  // keep scrolled to newest
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, selectedId]);

  // switching threads clears the composer
  useEffect(() => { setDraft(''); setPendingMentions([]); setMentionQuery(null); }, [selectedId]);

  // ---------------------------------------------------------------- mentions
  // Who/what can be @'d in this thread. Everyone may @ a person or @Managers
  // (so a dealer can escalate); @role and @All need manager+. Options are the
  // thread's own participants, which is what keeps it property-specific.
  const mentionOptions = useMemo(() => {
    if (!selected) return [];
    const opts = [];
    if (selected.conversation_type !== 'direct') {
      if (canBroadcast) opts.push({ kind: 'all', target_id: null, label: 'All', hint: 'everyone in this thread' });
      opts.push({ kind: 'managers', target_id: null, label: 'Managers', hint: 'managers and above here' });
      if (canBroadcast) {
        roles
          .filter(r => r.status !== 'archived')
          .filter(r => !r.assignedLocationIds?.length || !selected.location_id || r.assignedLocationIds.includes(selected.location_id))
          .forEach(r => opts.push({ kind: 'role', target_id: r.id, label: r.name, hint: 'everyone with this role here' }));
      }
    }
    selected.participantIds.filter(id => id !== myId)
      .forEach(id => opts.push({ kind: 'member', target_id: id, label: nameOf(id), hint: null }));
    return opts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.participantIds?.length, roles, canBroadcast, directory]);

  const filteredMentions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return mentionOptions.filter(o => !q || o.label.toLowerCase().includes(q)).slice(0, 8);
  }, [mentionOptions, mentionQuery]);

  // open the picker while the user is typing "@som…" at the end of the draft
  const onDraftChange = (value) => {
    setDraft(value);
    const m = value.match(/(?:^|\s)@([^@\n]{0,30})$/);
    setMentionQuery(m ? m[1] : null);
  };

  const pickMention = (opt) => {
    const replaced = draft.replace(/(^|\s)@([^@\n]{0,30})$/, `$1@${opt.label} `);
    setDraft(mentionQuery === null ? `${draft}${draft && !/\s$/.test(draft) ? ' ' : ''}@${opt.label} ` : replaced);
    setPendingMentions(list => list.some(x => x.kind === opt.kind && x.target_id === opt.target_id) ? list : [...list, opt]);
    setMentionQuery(null);
    inputRef.current?.focus();
  };

  const openMentionPicker = () => {
    if (mentionQuery !== null) { setMentionQuery(null); return; }
    setMentionQuery('');
    inputRef.current?.focus();
  };

  const myRoleIds = member?.assignedRoleIds || [];
  const mentionsMe = (m) => (m.mentions || []).some(x =>
    x.kind === 'all'
    || (x.kind === 'member' && x.target_id === myId)
    || (x.kind === 'managers' && canBroadcast)
    || (x.kind === 'role' && myRoleIds.includes(x.target_id)));

  // ------------------------------------------------------------------ actions
  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !selectedId) return;
    // only mentions whose @Label is still in the text count
    const used = pendingMentions
      .filter(m => text.includes(`@${m.label}`))
      .map(({ kind, target_id, label }) => ({ kind, target_id, label }));
    setDraft(''); setPendingMentions([]); setMentionQuery(null);
    try {
      await sendMessage(selectedId, myId, text, used);
      qc.invalidateQueries({ queryKey: ['messages', selectedId] });
      qc.invalidateQueries({ queryKey: ['conversations', myId] });
    } catch (e) {
      toast.error(sendErrorMessage(e, { silenced: amMuted, broadcast: used.some(m => m.kind === 'role' || m.kind === 'all') }));
      qc.invalidateQueries({ queryKey: ['messaging-mutes'] }); // picks up a fresh mute
      setDraft(text);
    }
  };

  const handleStartDm = async (otherId) => {
    try {
      const id = await startDM(myId, otherId);
      await qc.invalidateQueries({ queryKey: ['conversations', myId] });
      setNewDmOpen(false);
      setSelectedId(id);
    } catch (e) { toast.error(e.message || 'Could not start conversation'); }
  };

  const toggleMute = async () => {
    await setMuted(selectedId, myId, !selected.muted);
    qc.invalidateQueries({ queryKey: ['conversations', myId] });
    toast.success(selected.muted ? 'Unmuted — you’ll get alerts again' : 'Muted — you’ll still be alerted when someone @’s you');
  };

  const handleBlock = async () => {
    const otherId = selected.otherMemberIds[0];
    try {
      await blockMember(myId, otherId);
      qc.invalidateQueries({ queryKey: ['my-blocks', myId] });
      toast.success('Blocked');
    } catch (e) { toast.error(e.message?.includes('policy') ? "You can't block this person" : (e.message || 'Could not block')); }
  };

  // admin mute everywhere — the DB enforces who may mute whom
  const toggleMemberMute = async (memberId, muted, reason = null) => {
    try {
      await setMessagingMute(memberId, muted, reason);
      qc.invalidateQueries({ queryKey: ['messaging-mutes'] });
      toast.success(muted ? `${nameOf(memberId)} muted — they can read but not post anywhere` : `${nameOf(memberId)} unmuted`);
    } catch (e) { toast.error(e.message || 'Could not change mute'); }
  };

  const handleDelete = async (m) => {
    try {
      await softDeleteMessage(m.id, myId);
      qc.invalidateQueries({ queryKey: ['messages', selectedId] });
      if (m.sender_team_member_id !== myId) toast.success('Message removed');
    } catch (e) { toast.error(e.message || 'Could not remove message'); }
  };

  const submitFlag = async () => {
    try {
      await flagMessage({ messageId: flagTarget.id, conversationId: selectedId, byId: myId, reason: flagReason });
      setFlagTarget(null); setFlagReason('');
      toast.success('Flagged — admins have been notified to review it');
    } catch (e) {
      toast.error(/duplicate|unique/i.test(e.message || '') ? 'You already flagged this message' : (e.message || 'Could not flag'));
    }
  };

  return (
    <div className="max-w-6xl mx-auto h-[calc(100vh-9rem)] flex flex-col">
      <PageHeader title="Messages" subtitle="Direct messages, groups, and your role channels" />

      <div className="flex-1 min-h-0 border border-border rounded-lg overflow-hidden flex">
        {/* Conversation list */}
        <div className={cn('w-full sm:w-72 border-r border-border flex flex-col', selectedId && 'hidden sm:flex')}>
          <div className="p-2 border-b border-border flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="flex-1 gap-1.5 h-8" onClick={() => setNewDmOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> New DM
            </Button>
            {canBroadcast && (
              <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setNewGroupOpen(true)} title="New group">
                <Users className="w-3.5 h-3.5" />
              </Button>
            )}
            {isAdmin && (
              <Button size="sm" variant="outline" className="gap-1.5 h-8 relative" onClick={() => setMutesOpen(true)} title="Muted members">
                <ShieldOff className="w-3.5 h-3.5" />
                {mutes.length > 0 && <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-destructive text-white text-[9px] leading-4 text-center">{mutes.length}</span>}
              </Button>
            )}
          </div>
          {amMuted && (
            <div className="px-3 py-2 text-[11px] text-destructive bg-destructive/5 border-b border-border flex items-center gap-1.5">
              <VolumeX className="w-3.5 h-3.5 shrink-0" /> An admin has muted your messaging. You can read, but not post.
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            <Link to="/swap-board" className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/50 border-b border-border/50">
              <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 flex items-center justify-center shrink-0"><ArrowLeftRight className="w-4 h-4" /></div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Swap Board</p>
                <p className="text-[11px] text-muted-foreground">Pick up, give away, or trade shifts</p>
              </div>
            </Link>
            {conversations.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-8 px-4">No conversations yet. Start a DM to begin.</p>
            )}
            {conversations.map(c => (
              <button key={c.id} onClick={() => setSelectedId(c.id)}
                className={cn('w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/50 border-b border-border/50', selectedId === c.id && 'bg-muted')}>
                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-[11px] font-semibold">
                  {c.conversation_type === 'direct' ? initials(c.otherMemberIds[0]) : c.conversation_type === 'role_group' ? <Hash className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm truncate', c.hasUnread ? 'font-semibold' : 'font-medium')}>{convName(c)}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {c.conversation_type === 'group' && clubName(c.location_id) ? `${clubName(c.location_id)} · ` : ''}
                    {c.last_message_at ? format(new Date(c.last_message_at), 'MMM d, h:mm a') : 'No messages yet'}
                  </p>
                </div>
                {c.hasUnread && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                {c.muted && <BellOff className="w-3 h-3 text-muted-foreground shrink-0" />}
              </button>
            ))}
          </div>
        </div>

        {/* Thread */}
        <div className={cn('flex-1 flex-col min-w-0', selectedId ? 'flex' : 'hidden sm:flex')}>
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              <div className="text-center"><MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />Select a conversation</div>
            </div>
          ) : (
            <>
              <div className="p-3 border-b border-border flex items-center gap-2">
                <Button size="icon" variant="ghost" className="h-7 w-7 sm:hidden" onClick={() => setSelectedId(null)}><ChevronLeft className="w-4 h-4" /></Button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{convName(selected)}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {selected.conversation_type === 'direct' ? 'Direct message'
                      : selected.conversation_type === 'role_group' ? `Role channel · ${selected.participantIds.length} members`
                      : `Group${clubName(selected.location_id) ? ` · ${clubName(selected.location_id)}` : ''} · ${selected.participantIds.length} members`}
                  </p>
                </div>
                {selected.conversation_type !== 'direct' && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs hidden sm:inline-flex" onClick={() => setManageOpen(true)}>
                    {canMod ? <Settings2 className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />}
                    {canMod ? 'Manage' : 'Members'}
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7"><MoreVertical className="w-4 h-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={toggleMute}>
                      {selected.muted ? <><Bell className="w-4 h-4 mr-2" /> Unmute</> : <><BellOff className="w-4 h-4 mr-2" /> Mute (still alerts on @)</>}
                    </DropdownMenuItem>
                    {selected.conversation_type !== 'direct' && (
                      <DropdownMenuItem onClick={() => setManageOpen(true)}>
                        {canMod ? <><Settings2 className="w-4 h-4 mr-2" /> Manage group</> : <><Users className="w-4 h-4 mr-2" /> Members</>}
                      </DropdownMenuItem>
                    )}
                    {selected.conversation_type === 'direct' && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={handleBlock}><Ban className="w-4 h-4 mr-2" /> Block</DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-0.5">
                {messages.map((m, i) => {
                  const mine = m.sender_team_member_id === myId;
                  const prev = messages[i - 1];
                  const showDay = !prev || !isSameDay(new Date(prev.created_at), new Date(m.created_at));
                  const showSender = selected.conversation_type !== 'direct' && !mine && (!prev || prev.sender_team_member_id !== m.sender_team_member_id || showDay);
                  const forMe = !mine && !m.deleted_at && mentionsMe(m);
                  return (
                    <React.Fragment key={m.id}>
                      {showDay && <div className="text-center text-[10px] text-muted-foreground my-3">{format(new Date(m.created_at), 'EEEE, MMM d')}</div>}
                      <div className={cn('group flex flex-col', mine ? 'items-end' : 'items-start')}>
                        {showSender && <span className="text-[10px] text-muted-foreground ml-1 mb-0.5">{nameOf(m.sender_team_member_id)}</span>}
                        <div className={cn('max-w-[75%] rounded-2xl px-3 py-1.5 text-sm',
                          mine ? 'bg-primary text-primary-foreground' : 'bg-muted',
                          forMe && 'ring-2 ring-primary/50')}>
                          {m.deleted_at
                            ? <span className="italic opacity-60">Message removed</span>
                            : <MessageBody body={m.body} mentions={m.mentions} mine={mine} />}
                          <span className={cn('block text-[9px] mt-0.5', mine ? 'text-primary-foreground/60' : 'text-muted-foreground')}>
                            {format(new Date(m.created_at), 'h:mm a')}{m.updated_at > m.created_at && !m.deleted_at ? ' · edited' : ''}
                          </span>
                        </div>
                        {!m.deleted_at && (
                          <div className={cn('flex gap-2.5 mt-0.5 text-[10px] text-muted-foreground transition-opacity',
                            'opacity-50 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100', mine ? 'mr-1' : 'ml-1')}>
                            {(mine || canMod) && (
                              <button type="button" className="hover:text-destructive inline-flex items-center gap-0.5" onClick={() => handleDelete(m)}>
                                <Trash2 className="w-3 h-3" /> {mine ? 'delete' : 'remove'}
                              </button>
                            )}
                            {!mine && (
                              <button type="button" className="hover:text-amber-600 inline-flex items-center gap-0.5" onClick={() => { setFlagTarget(m); setFlagReason(''); }}>
                                <Flag className="w-3 h-3" /> flag
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </React.Fragment>
                  );
                })}
                {messages.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">No messages yet — say hello.</p>}
              </div>

              {amMuted ? (
                <div className="p-3 border-t border-border flex items-center gap-2 text-xs text-muted-foreground bg-muted/40">
                  <VolumeX className="w-4 h-4 text-destructive shrink-0" />
                  An admin has muted your messaging. You can read, but you can’t post until an admin unmutes you.
                </div>
              ) : (
                <div className="relative p-2 border-t border-border">
                  {mentionQuery !== null && filteredMentions.length > 0 && (
                    <div className="absolute bottom-full left-2 right-2 mb-1 rounded-md border border-border bg-popover shadow-md max-h-56 overflow-y-auto z-10">
                      {filteredMentions.map(o => (
                        <button key={`${o.kind}-${o.target_id || o.label}`} type="button" onMouseDown={e => e.preventDefault()} onClick={() => pickMention(o)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-muted/60">
                          <span className={cn('w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0',
                            o.kind === 'member' ? 'bg-primary/10 text-primary' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300')}>
                            {o.kind === 'member' ? initials(o.target_id) : <AtSign className="w-3 h-3" />}
                          </span>
                          <span className="font-medium">@{o.label}</span>
                          {o.hint && <span className="text-[11px] text-muted-foreground truncate">{o.hint}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-end gap-1.5">
                    <Button size="icon" variant={mentionQuery !== null ? 'secondary' : 'ghost'} className="h-9 w-9 shrink-0" title="Mention someone" onClick={openMentionPicker}>
                      <AtSign className="w-4 h-4" />
                    </Button>
                    <textarea
                      ref={inputRef}
                      value={draft} onChange={e => onDraftChange(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Escape' && mentionQuery !== null) { e.preventDefault(); setMentionQuery(null); return; }
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (mentionQuery !== null && filteredMentions.length) pickMention(filteredMentions[0]);
                          else handleSend();
                        }
                      }}
                      rows={1} placeholder="Message… (type @ to mention)"
                      className="flex-1 resize-none max-h-28 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                    />
                    <Button size="icon" className="h-9 w-9 shrink-0" onClick={handleSend} disabled={!draft.trim()}><Send className="w-4 h-4" /></Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* New DM */}
      <Dialog open={newDmOpen} onOpenChange={setNewDmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-base">New direct message</DialogTitle></DialogHeader>
          <div>
            <Label className="text-xs">To</Label>
            <TeamMemberCombobox value="" onChange={handleStartDm} eligibleTeamMembers={dmCandidates} placeholder="Search team member…" />
            <p className="text-[11px] text-muted-foreground mt-1">You can message people who share a location with you.</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Group */}
      <NewGroupDialog open={newGroupOpen} onClose={() => setNewGroupOpen(false)} candidates={dmCandidates} nameOf={nameOf}
        clubs={myClubs} defaultClubId={member?.homeLocationId}
        onCreate={async (title, ids, locationId) => {
          try {
            const id = await createGroup(title, ids, myId, locationId);
            await qc.invalidateQueries({ queryKey: ['conversations', myId] });
            setNewGroupOpen(false); setSelectedId(id);
          } catch (e) { toast.error(e.message || 'Could not create group'); }
        }} />

      {/* Members / Manage group */}
      {selected && selected.conversation_type !== 'direct' && (
        <ManageGroupDialog open={manageOpen} onClose={() => setManageOpen(false)}
          conversation={selected} canModerate={canMod} myId={myId} nameOf={nameOf} initials={initials}
          candidates={dmCandidates} clubs={myClubs} mutedIds={mutedIds} onToggleMute={toggleMemberMute} />
      )}

      {/* Muted members (admins) */}
      {isAdmin && (
        <MutedMembersDialog open={mutesOpen} onClose={() => setMutesOpen(false)} mutes={mutes} myId={myId} outranks={outranks} onToggleMute={toggleMemberMute} />
      )}

      {/* Flag a message */}
      <Dialog open={!!flagTarget} onOpenChange={(o) => { if (!o) setFlagTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2"><Flag className="w-4 h-4 text-amber-500" /> Flag this message</DialogTitle>
            <DialogDescription>Admins for this club will be notified and review it. The sender won’t be told who flagged it.</DialogDescription>
          </DialogHeader>
          {flagTarget && (
            <blockquote className="text-sm border-l-2 border-border pl-3 text-muted-foreground line-clamp-4">
              <span className="font-medium text-foreground">{nameOf(flagTarget.sender_team_member_id)}:</span> {flagTarget.body}
            </blockquote>
          )}
          <div>
            <Label className="text-xs">Why are you flagging it? (optional)</Label>
            <Textarea rows={3} value={flagReason} onChange={e => setFlagReason(e.target.value)} placeholder="e.g. harassment, not work-appropriate, wrong channel…" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFlagTarget(null)}>Cancel</Button>
            <Button onClick={submitFlag}>Flag for review</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Message text with each @mention highlighted.
function MessageBody({ body, mentions, mine }) {
  const labels = (mentions || []).map(m => `@${m.label}`).filter(l => l.length > 1).sort((a, b) => b.length - a.length);
  if (!labels.length) return <span className="whitespace-pre-wrap break-words">{body}</span>;
  const re = new RegExp(`(${labels.map(escapeRe).join('|')})`, 'g');
  return (
    <span className="whitespace-pre-wrap break-words">
      {body.split(re).map((part, i) => labels.includes(part)
        ? <span key={i} className={cn('font-semibold rounded px-0.5', mine ? 'bg-white/20' : 'bg-primary/15 text-primary')}>{part}</span>
        : part)}
    </span>
  );
}

function ClubSelect({ value, onChange, clubs, className }) {
  return (
    <Select value={value || NO_CLUB} onValueChange={v => onChange(v === NO_CLUB ? null : v)}>
      <SelectTrigger className={cn('h-9', className)}><SelectValue placeholder="Club" /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_CLUB}>No club (company-wide)</SelectItem>
        {clubs.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function NewGroupDialog({ open, onClose, candidates, nameOf, clubs, defaultClubId, onCreate }) {
  const [title, setTitle] = useState('');
  const [ids, setIds] = useState([]);
  const [search, setSearch] = useState('');
  const [clubId, setClubId] = useState(null);
  useEffect(() => {
    if (!open) return;
    setTitle(''); setIds([]); setSearch('');
    // default club: my only club, else my home club if I manage it
    setClubId(clubs.length === 1 ? clubs[0].id : (clubs.some(c => c.id === defaultClubId) ? defaultClubId : null));
  }, [open, clubs, defaultClubId]);
  const filtered = candidates.filter(c => !search.trim() || nameOf(c.id).toLowerCase().includes(search.toLowerCase()));
  const toggle = (id) => setIds(x => x.includes(id) ? x.filter(i => i !== id) : [...x, id]);
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-base">New group</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Group name</Label><Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Las Colinas Floor" /></div>
          <div>
            <Label className="text-xs">Club</Label>
            <ClubSelect value={clubId} onChange={setClubId} clubs={clubs} />
            <p className="text-[11px] text-muted-foreground mt-1">Sets which admins moderate this group.</p>
          </div>
          <div>
            <Label className="text-xs">Add members{ids.length ? ` (${ids.length})` : ''}</Label>
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="mb-1.5" />
            <div className="max-h-44 overflow-y-auto border border-border rounded-md">
              {filtered.map(c => (
                <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted/50 cursor-pointer">
                  <input type="checkbox" checked={ids.includes(c.id)} onChange={() => toggle(c.id)} className="accent-primary" />
                  {nameOf(c.id)}
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!title.trim() || ids.length === 0} onClick={() => onCreate(title, ids, clubId)}>Create group</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Members list for everyone; rename / club / add / remove / mute for moderators.
// Role channels auto-populate from role assignments, so they only get mute.
function ManageGroupDialog({ open, onClose, conversation, canModerate, myId, nameOf, initials, candidates, clubs, mutedIds, onToggleMute }) {
  const qc = useQueryClient();
  const isGroup = conversation.conversation_type === 'group';
  const { data: participants = [] } = useConversationParticipants(open ? conversation.id : null);
  const [title, setTitle] = useState(conversation.title || '');
  const [clubId, setClubId] = useState(conversation.location_id || null);
  const [addSearch, setAddSearch] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setTitle(conversation.title || ''); setClubId(conversation.location_id || null); setAddSearch(''); }
  }, [open, conversation.id, conversation.title, conversation.location_id]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['conversation-participants', conversation.id] });
    qc.invalidateQueries({ queryKey: ['conversations', myId] });
  };
  const run = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); refresh(); if (okMsg) toast.success(okMsg); }
    catch (e) { toast.error(/row-level security|policy/i.test(e.message || '') ? "You don't have permission to do that here" : (e.message || 'Something went wrong')); }
    finally { setBusy(false); }
  };

  const detailsDirty = title.trim() !== (conversation.title || '') || (clubId || null) !== (conversation.location_id || null);
  const inGroup = new Set(participants.map(p => p.team_member_id));
  const addable = candidates.filter(c => !inGroup.has(c.id) && (!addSearch.trim() || nameOf(c.id).toLowerCase().includes(addSearch.toLowerCase()))).slice(0, 8);
  const sorted = [...participants].sort((a, b) => nameOf(a.team_member_id).localeCompare(nameOf(b.team_member_id)));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{canModerate ? 'Manage group' : 'Members'}</DialogTitle>
          {canModerate && <DialogDescription>Muting a member stops them posting anywhere in Messages (they can still read) until an admin unmutes them.</DialogDescription>}
        </DialogHeader>

        {canModerate && isGroup && (
          <div className="space-y-2 pb-3 border-b border-border">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><Label className="text-xs">Group name</Label><Input value={title} onChange={e => setTitle(e.target.value)} className="h-9" /></div>
              <div><Label className="text-xs">Club</Label><ClubSelect value={clubId} onChange={setClubId} clubs={clubs} /></div>
            </div>
            {detailsDirty && (
              <Button size="sm" disabled={busy || !title.trim()} onClick={() => run(() => updateGroup(conversation.id, { title, locationId: clubId }), 'Group updated')}>
                Save changes
              </Button>
            )}
          </div>
        )}

        <div>
          <Label className="text-xs">{participants.length} member{participants.length === 1 ? '' : 's'}</Label>
          <div className="max-h-60 overflow-y-auto border border-border rounded-md mt-1">
            {sorted.map(p => {
              const me = p.team_member_id === myId;
              const silenced = mutedIds?.has(p.team_member_id);
              return (
                <div key={p.team_member_id} className="flex items-center gap-2 px-2 py-1.5 text-sm border-b border-border/50 last:border-0">
                  <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-semibold shrink-0">{initials(p.team_member_id)}</span>
                  <span className="flex-1 min-w-0 truncate">{nameOf(p.team_member_id)}{me ? ' (you)' : ''}</span>
                  {silenced && <Badge variant="outline" className="text-[10px] text-destructive border-destructive/40 gap-1"><VolumeX className="w-3 h-3" /> muted</Badge>}
                  {canModerate && !me && (
                    <>
                      <Button size="icon" variant="ghost" className="h-7 w-7" disabled={busy} title={silenced ? 'Unmute (let them post again)' : 'Mute everywhere (they can read, not post)'}
                        onClick={() => onToggleMute(p.team_member_id, !silenced)}>
                        {silenced ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                      </Button>
                      {isGroup && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" disabled={busy} title="Remove from group"
                          onClick={() => run(() => removeParticipant(conversation.id, p.team_member_id), 'Removed from group')}>
                          <UserMinus className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {participants.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>}
          </div>
        </div>

        {canModerate && isGroup && (
          <div>
            <Label className="text-xs flex items-center gap-1"><UserPlus className="w-3 h-3" /> Add members</Label>
            <Input value={addSearch} onChange={e => setAddSearch(e.target.value)} placeholder="Search team members…" className="h-9 mt-1" />
            {addSearch.trim() && (
              <div className="border border-border rounded-md mt-1 max-h-40 overflow-y-auto">
                {addable.map(c => (
                  <button key={c.id} type="button" disabled={busy}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-left hover:bg-muted/50"
                    onClick={() => run(() => addParticipants(conversation.id, [c.id]), `${nameOf(c.id)} added`)}>
                    <Plus className="w-3.5 h-3.5 text-muted-foreground" /> {nameOf(c.id)}
                  </button>
                ))}
                {addable.length === 0 && <p className="text-xs text-muted-foreground px-2 py-2">No one matches.</p>}
              </div>
            )}
          </div>
        )}

        {!canModerate && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5" /> Something off in this thread? Hover a message and choose <em>flag</em> to send it to the admins.
          </p>
        )}
        {canModerate && !isGroup && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5" /> Role channels fill automatically from role assignments, so members can’t be added or removed here.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
