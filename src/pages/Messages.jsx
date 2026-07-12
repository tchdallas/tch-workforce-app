import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabase';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { useRoles, useLocations } from '@/lib/useAppData';
import {
  useMyConversations, useMessages, useMyBlocks, useMessagingDirectory,
  sendMessage, markRead, setMuted, startDM, createGroup, blockMember, unblockMember, softDeleteMessage,
} from '@/lib/messaging';
import PageHeader from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import TeamMemberCombobox from '@/components/common/TeamMemberCombobox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MessageSquare, Plus, Users, Send, ChevronLeft, MoreVertical, Bell, BellOff, Ban, Hash, Trash2 } from 'lucide-react';
import { format, isSameDay } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function Messages() {
  const qc = useQueryClient();
  const { member, isManager } = useCurrentMember();
  const myId = member?.id;
  const { data: directory = [] } = useMessagingDirectory(myId);
  const { data: roles = [] } = useRoles();
  const { data: locations = [] } = useLocations();
  const { data: conversations = [] } = useMyConversations(myId);
  const { data: myBlocks = [] } = useMyBlocks(myId);

  const [selectedId, setSelectedId] = useState(null);
  const { data: messages = [] } = useMessages(selectedId);
  const selected = conversations.find(c => c.id === selectedId);

  const [newDmOpen, setNewDmOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef(null);

  const memberById = useMemo(() => Object.fromEntries(directory.map(m => [m.id, m])), [directory]);
  const nameOf = (id) => { const m = memberById[id]; return m ? `${m.preferredName || m.firstName} ${m.lastName}` : 'Unknown'; };
  const initials = (id) => nameOf(id).split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  const convName = (c) => {
    if (!c) return '';
    if (c.conversation_type === 'direct') return c.otherMemberIds.length ? nameOf(c.otherMemberIds[0]) : 'Direct message';
    if (c.conversation_type === 'role_group') {
      const r = roles.find(x => x.id === c.role_id);
      const l = locations.find(x => x.id === c.location_id);
      return `${r?.name || 'Role'}${l ? ` · ${l.name}` : ''}`;
    }
    return c.title || 'Group';
  };

  // people I can DM: the directory already limits to coworkers sharing a
  // location (can_dm); just drop anyone I've blocked.
  const dmCandidates = useMemo(
    () => directory.filter(m => m.canDm && !myBlocks.includes(m.id)),
    [directory, myBlocks]);

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
    markRead(selectedId, myId).then(() => qc.invalidateQueries({ queryKey: ['conversations', myId] }));
  }, [selectedId, myId, messages.length]); // eslint-disable-line

  // keep scrolled to newest
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, selectedId]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !selectedId) return;
    setDraft('');
    try {
      await sendMessage(selectedId, myId, text);
      qc.invalidateQueries({ queryKey: ['messages', selectedId] });
      qc.invalidateQueries({ queryKey: ['conversations', myId] });
    } catch (e) { toast.error(e.message || 'Could not send'); setDraft(text); }
  };

  const openConversation = (id) => setSelectedId(id);

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
    toast.success(selected.muted ? 'Unmuted' : 'Muted');
  };

  const handleBlock = async () => {
    const otherId = selected.otherMemberIds[0];
    try {
      await blockMember(myId, otherId);
      qc.invalidateQueries({ queryKey: ['my-blocks', myId] });
      toast.success('Blocked');
    } catch (e) { toast.error(e.message?.includes('policy') ? "You can't block this person" : (e.message || 'Could not block')); }
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
            {isManager && (
              <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setNewGroupOpen(true)} title="New group">
                <Users className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-8 px-4">No conversations yet. Start a DM to begin.</p>
            )}
            {conversations.map(c => (
              <button key={c.id} onClick={() => openConversation(c.id)}
                className={cn('w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/50 border-b border-border/50', selectedId === c.id && 'bg-muted')}>
                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-[11px] font-semibold">
                  {c.conversation_type === 'direct' ? initials(c.otherMemberIds[0]) : c.conversation_type === 'role_group' ? <Hash className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm truncate', c.hasUnread ? 'font-semibold' : 'font-medium')}>{convName(c)}</p>
                  <p className="text-[11px] text-muted-foreground">{c.last_message_at ? format(new Date(c.last_message_at), 'MMM d, h:mm a') : 'No messages yet'}</p>
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
                  <p className="text-[11px] text-muted-foreground">
                    {selected.conversation_type === 'direct' ? 'Direct message'
                      : selected.conversation_type === 'role_group' ? `Role channel · ${selected.participantIds.length} members`
                      : `Group · ${selected.participantIds.length} members`}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7"><MoreVertical className="w-4 h-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={toggleMute}>
                      {selected.muted ? <><Bell className="w-4 h-4 mr-2" /> Unmute</> : <><BellOff className="w-4 h-4 mr-2" /> Mute</>}
                    </DropdownMenuItem>
                    {selected.conversation_type === 'direct' && (
                      <DropdownMenuItem className="text-destructive" onClick={handleBlock}><Ban className="w-4 h-4 mr-2" /> Block</DropdownMenuItem>
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
                  return (
                    <React.Fragment key={m.id}>
                      {showDay && <div className="text-center text-[10px] text-muted-foreground my-3">{format(new Date(m.created_at), 'EEEE, MMM d')}</div>}
                      <div className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                        {showSender && <span className="text-[10px] text-muted-foreground ml-1 mb-0.5">{nameOf(m.sender_team_member_id)}</span>}
                        <div className={cn('group max-w-[75%] rounded-2xl px-3 py-1.5 text-sm', mine ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                          {m.deleted_at ? <span className="italic opacity-60">Message removed</span> : <span className="whitespace-pre-wrap break-words">{m.body}</span>}
                          <span className={cn('block text-[9px] mt-0.5', mine ? 'text-primary-foreground/60' : 'text-muted-foreground')}>
                            {format(new Date(m.created_at), 'h:mm a')}{m.updated_at > m.created_at && !m.deleted_at ? ' · edited' : ''}
                          </span>
                        </div>
                        {mine && !m.deleted_at && (
                          <button className="text-[9px] text-muted-foreground opacity-0 hover:opacity-100 mt-0.5" onClick={async () => { await softDeleteMessage(m.id, myId); qc.invalidateQueries({ queryKey: ['messages', selectedId] }); }}>
                            <Trash2 className="w-3 h-3 inline" /> delete
                          </button>
                        )}
                      </div>
                    </React.Fragment>
                  );
                })}
                {messages.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">No messages yet — say hello.</p>}
              </div>

              <div className="p-2 border-t border-border flex items-end gap-2">
                <textarea
                  value={draft} onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  rows={1} placeholder="Message…"
                  className="flex-1 resize-none max-h-28 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
                <Button size="icon" className="h-9 w-9 shrink-0" onClick={handleSend} disabled={!draft.trim()}><Send className="w-4 h-4" /></Button>
              </div>
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
        onCreate={async (title, ids) => {
          try {
            const id = await createGroup(title, ids, myId);
            await qc.invalidateQueries({ queryKey: ['conversations', myId] });
            setNewGroupOpen(false); setSelectedId(id);
          } catch (e) { toast.error(e.message || 'Could not create group'); }
        }} />
    </div>
  );
}

function NewGroupDialog({ open, onClose, candidates, nameOf, onCreate }) {
  const [title, setTitle] = useState('');
  const [ids, setIds] = useState([]);
  const [search, setSearch] = useState('');
  useEffect(() => { if (open) { setTitle(''); setIds([]); setSearch(''); } }, [open]);
  const filtered = candidates.filter(c => !search.trim() || nameOf(c.id).toLowerCase().includes(search.toLowerCase()));
  const toggle = (id) => setIds(x => x.includes(id) ? x.filter(i => i !== id) : [...x, id]);
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-base">New group</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Group name</Label><Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Las Colinas Floor" /></div>
          <div>
            <Label className="text-xs">Add members{ids.length ? ` (${ids.length})` : ''}</Label>
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="mb-1.5" />
            <div className="max-h-48 overflow-y-auto border border-border rounded-md">
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
          <Button disabled={!title.trim() || ids.length === 0} onClick={() => onCreate(title, ids)}>Create group</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
