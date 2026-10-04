import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabase';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { useTeamMembers } from '@/lib/useAppData';
import { useMessagingDirectory } from '@/lib/messaging';
import {
  INTENTS, STATUSES, useMyBoards, useSwapPosts, useSwapReplies, useSwapReplyCounts, useSwapBoardMutes,
  useShiftsById, useUpcomingShifts, useAppSettings, swapApprovalRequired,
  createSwapPost, cancelSwapPost, addSwapReply, deleteSwapReply, initiateSwap, withdrawSwap, respondToDeal, setBoardMuted,
} from '@/lib/swapBoard';
import PageHeader from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ArrowLeftRight, Plus, ChevronLeft, MessageSquare, Bell, BellOff, Gift, HandHelping, Send, Trash2,
  Check, X, Clock, Undo2, Ban, Info, Filter,
} from 'lucide-react';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { formatEndTime, cn } from '@/lib/utils';
import { toast } from 'sonner';

const intentIcon = { pickup: HandHelping, giveaway: Gift, trade: ArrowLeftRight };
const fmtShift = (s) => s ? `${format(new Date(s.startDateTime), 'EEE, MMM d · h:mm a')} – ${formatEndTime(s.startDateTime, s.endDateTime)}` : 'shift';
const friendlyError = (e) => {
  const m = e?.message || '';
  if (/row-level security|policy/i.test(m)) return "You can't do that here";
  return m || 'Something went wrong';
};

export default function SwapBoard() {
  const qc = useQueryClient();
  const { member, isManager, scopeLocations } = useCurrentMember();
  const myId = member?.id;
  const mgr = !!member && isManager;
  const boards = useMyBoards(member, { isManager: mgr, scopeLocations });
  const { data: directory = [] } = useMessagingDirectory(myId);
  const { data: teamMembers = [] } = useTeamMembers(); // managers: names beyond my clubs (RLS trims it for everyone else)
  const { data: mutes = [] } = useSwapBoardMutes(myId);
  const { data: settings = [] } = useAppSettings();

  // board selection: ?b=<loc>:<role>; default = my first board
  const [searchParams, setSearchParams] = useSearchParams();
  const [boardKey, setBoardKey] = useState(() => searchParams.get('b') || null);
  useEffect(() => {
    if (!boardKey && boards.length) setBoardKey(boards[0].key);
    if (boardKey && boards.length && !boards.some(b => b.key === boardKey)) setBoardKey(boards[0].key);
  }, [boards, boardKey]);
  const board = boards.find(b => b.key === boardKey) || null;
  const [showClosed, setShowClosed] = useState(false);
  const [intentFilter, setIntentFilter] = useState(null);

  const { data: postsRaw = [] } = useSwapPosts({ locationId: board?.locationId, roleId: board?.roleId, includeClosed: showClosed });
  const posts = useMemo(() => postsRaw.filter(p => !intentFilter || p.intent === intentFilter), [postsRaw, intentFilter]);
  const { data: counts = {} } = useSwapReplyCounts(posts.map(p => p.id));
  const { data: shifts = [] } = useShiftsById(posts.flatMap(p => [p.shift_id, p.deal_shift_id]));
  const shiftById = (id) => shifts.find(s => s.id === id);

  // deep link to a post: ?p=<id> (notifications)
  const [selectedId, setSelectedId] = useState(null);
  useEffect(() => {
    const p = searchParams.get('p');
    if (!p) return;
    (async () => {
      const { data } = await supabase.from('swap_posts').select('id, location_id, role_id, status').eq('id', p).maybeSingle();
      if (data) {
        setBoardKey(`${data.location_id}:${data.role_id}`);
        if (['completed', 'cancelled'].includes(data.status)) setShowClosed(true);
        setSelectedId(data.id);
      }
      setSearchParams({}, { replace: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  useEffect(() => { if (board) setSearchParams(board ? { b: board.key } : {}, { replace: true }); }, [board?.key]); // eslint-disable-line

  // names: directory covers my clubs; team members list covers managers' reach
  const nameOf = useMemo(() => {
    const map = {};
    teamMembers.forEach(m => { map[m.id] = `${m.preferredName || m.firstName} ${m.lastName}`; });
    directory.forEach(m => { map[m.id] = `${m.preferredName || m.firstName} ${m.lastName}`; });
    return (id) => (id === myId ? 'You' : (map[id] || 'Team member'));
  }, [teamMembers, directory, myId]);

  const selected = posts.find(p => p.id === selectedId) || null;
  const isMuted = !!board && mutes.some(m => m.location_id === board.locationId && m.role_id === board.roleId);
  const [newOpen, setNewOpen] = useState(false);

  // live: new posts/replies on this board
  useEffect(() => {
    if (!myId || !board) return;
    let channel; let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || cancelled) return;
      supabase.realtime.setAuth(session.access_token);
      channel = supabase.channel(`swap-board-${board.key}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'swap_posts', filter: `location_id=eq.${board.locationId}` },
          () => qc.invalidateQueries({ queryKey: ['swap-posts'] }))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'swap_replies' },
          (payload) => {
            qc.invalidateQueries({ queryKey: ['swap-replies', payload.new?.post_id || payload.old?.post_id] });
            qc.invalidateQueries({ queryKey: ['swap-reply-counts'] });
          })
        .subscribe();
    })();
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [myId, board?.key, qc]); // eslint-disable-line

  const toggleBoardMute = async () => {
    try {
      await setBoardMuted(myId, board.locationId, board.roleId, !isMuted);
      qc.invalidateQueries({ queryKey: ['swap-board-mutes'] });
      toast.success(isMuted ? 'You’ll be alerted about new posts on this board' : 'Board alerts muted — replies to your own posts still notify you');
    } catch (e) { toast.error(friendlyError(e)); }
  };

  if (member && boards.length === 0) {
    return (
      <div className="max-w-6xl mx-auto">
        <PageHeader title="Swap Board" subtitle="Pick up, give away, or trade shifts with your role at your club" />
        <p className="text-sm text-muted-foreground">You don’t have a role and club assigned yet, so there’s no board to show. Ask a manager to check your profile.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto h-[calc(100vh-9rem)] flex flex-col">
      <PageHeader title="Swap Board" subtitle="Pick up, give away, or trade shifts with your role at your club">
        <div className="flex items-center gap-2">
          {boards.length > 1 && (
            <Select value={boardKey || ''} onValueChange={(v) => { setBoardKey(v); setSelectedId(null); }}>
              <SelectTrigger className="h-9 w-56"><SelectValue placeholder="Choose a board" /></SelectTrigger>
              <SelectContent>
                {boards.map(b => (
                  <SelectItem key={b.key} value={b.key}>
                    {b.role.name} · {b.location.abbreviation || b.location.name}{!b.mine ? ' (manager view)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {board && (
            <Button size="icon" variant="outline" className="h-9 w-9" title={isMuted ? 'Unmute board alerts' : 'Mute board alerts'} onClick={toggleBoardMute}>
              {isMuted ? <BellOff className="w-4 h-4 text-muted-foreground" /> : <Bell className="w-4 h-4" />}
            </Button>
          )}
          {board?.mine && (
            <Button className="h-9 gap-1.5" onClick={() => setNewOpen(true)}><Plus className="w-4 h-4" /> New post</Button>
          )}
        </div>
      </PageHeader>

      <div className="flex-1 min-h-0 border border-border rounded-lg overflow-hidden flex">
        {/* Tiles */}
        <div className={cn('w-full sm:w-80 md:w-96 border-r border-border flex flex-col', selectedId && 'hidden sm:flex')}>
          <div className="p-2 border-b border-border flex items-center gap-1 flex-wrap">
            <Filter className="w-3.5 h-3.5 text-muted-foreground ml-1" />
            {[null, 'pickup', 'giveaway', 'trade'].map(i => (
              <button key={i || 'all'} type="button" onClick={() => setIntentFilter(i)}
                className={cn('px-2 py-0.5 rounded-full text-[11px] border', intentFilter === i ? 'bg-foreground text-background border-foreground' : 'border-border hover:bg-muted')}>
                {i ? INTENTS[i].short : 'All'}
              </button>
            ))}
            <button type="button" onClick={() => setShowClosed(v => !v)}
              className={cn('ml-auto px-2 py-0.5 rounded-full text-[11px] border', showClosed ? 'bg-foreground text-background border-foreground' : 'border-border hover:bg-muted')}>
              {showClosed ? 'Hiding none' : 'Show done'}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {board && !board.mine && (
              <p className="text-[11px] text-muted-foreground px-3 py-2 border-b border-border/50 flex items-center gap-1.5"><Info className="w-3 h-3" /> Manager view — you can read, reply, and cancel posts here.</p>
            )}
            {posts.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-10 px-4">
                Nothing on this board{intentFilter ? ' for that filter' : ''} yet.{board?.mine ? ' Post if you’re looking to pick up, give away, or trade a shift.' : ''}
              </p>
            )}
            {posts.map(p => <PostTile key={p.id} post={p} shift={shiftById(p.shift_id)} dealShift={shiftById(p.deal_shift_id)}
              nameOf={nameOf} replies={counts[p.id] || 0} selected={selectedId === p.id} onClick={() => setSelectedId(p.id)} />)}
          </div>
        </div>

        {/* Thread */}
        <div className={cn('flex-1 flex-col min-w-0', selectedId ? 'flex' : 'hidden sm:flex')}>
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              <div className="text-center"><ArrowLeftRight className="w-8 h-8 mx-auto mb-2 opacity-30" />Select a post</div>
            </div>
          ) : (
            <PostThread key={selected.id} post={selected} board={board} myId={myId} member={member} isManager={mgr}
              shift={shiftById(selected.shift_id)} dealShift={shiftById(selected.deal_shift_id)} nameOf={nameOf}
              settings={settings} onBack={() => setSelectedId(null)} />
          )}
        </div>
      </div>

      {board?.mine && (
        <NewPostDialog open={newOpen} onClose={() => setNewOpen(false)} board={board} myId={myId}
          onCreated={(id) => { setNewOpen(false); setSelectedId(id); qc.invalidateQueries({ queryKey: ['swap-posts'] }); }} />
      )}
    </div>
  );
}

function PostTile({ post, shift, dealShift, nameOf, replies, selected, onClick }) {
  const Icon = intentIcon[post.intent];
  const intent = INTENTS[post.intent]; const status = STATUSES[post.status];
  return (
    <button type="button" onClick={onClick}
      className={cn('w-full text-left px-3 py-2.5 border-b border-border/50 hover:bg-muted/50', selected && 'bg-muted', post.status !== 'open' && post.status !== 'pending' && 'opacity-70')}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold', intent.className)}><Icon className="w-3 h-3" /> {intent.label}</span>
        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold', status.className)}>{status.label}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">{formatDistanceToNowStrict(new Date(post.created_at), { addSuffix: true })}</span>
      </div>
      <p className="text-sm font-medium truncate">{nameOf(post.author_id)}{post.shift_id ? <span className="font-normal text-muted-foreground"> · {fmtShift(shift)}</span> : null}</p>
      {post.note && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{post.note}</p>}
      <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
        {post.status === 'pending' && post.counterpart_id && <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> with {nameOf(post.counterpart_id)}{dealShift && post.intent !== 'giveaway' ? ` · ${fmtShift(dealShift)}` : ''}</span>}
        <span className="inline-flex items-center gap-1 ml-auto"><MessageSquare className="w-3 h-3" /> {replies}</span>
      </div>
    </button>
  );
}

function PostThread({ post, board, myId, member, isManager, shift, dealShift, nameOf, settings, onBack }) {
  const qc = useQueryClient();
  const { data: replies = [] } = useSwapReplies(post.id);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [pickFor, setPickFor] = useState(null); // trade: counterpart id whose shift to pick
  const [offerOpen, setOfferOpen] = useState(false); // pickup: offer my shift
  const scrollRef = useRef(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [replies.length]);

  const mine = post.author_id === myId;
  const canModerate = isManager; // boards listed for a manager are only at clubs they manage
  const intent = INTENTS[post.intent]; const status = STATUSES[post.status];
  const Icon = intentIcon[post.intent];
  const repliers = useMemo(() => [...new Set(replies.filter(r => r.kind === 'reply' && !r.deleted_at && r.author_id && r.author_id !== post.author_id).map(r => r.author_id))], [replies, post.author_id]);
  // who must act on the pending deal: giveaway/trade -> counterpart; pickup -> poster
  const awaitingMe = post.status === 'pending' && ((post.intent !== 'pickup' && post.counterpart_id === myId) || (post.intent === 'pickup' && mine));
  const dealShiftId = post.intent === 'pickup' ? post.deal_shift_id : post.shift_id; // the shift I'd receive
  const dealLoc = (post.intent === 'pickup' ? dealShift : shift)?.locationId || post.location_id;
  const requireApproval = swapApprovalRequired(settings, dealLoc);

  const refresh = () => { qc.invalidateQueries({ queryKey: ['swap-posts'] }); qc.invalidateQueries({ queryKey: ['swap-replies', post.id] }); qc.invalidateQueries({ queryKey: ['swap-reply-counts'] }); };
  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); refresh(); if (ok) toast.success(ok); }
    catch (e) { toast.error(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const send = async () => {
    const text = draft.trim(); if (!text) return;
    setDraft('');
    try { await addSwapReply(post.id, myId, text); refresh(); }
    catch (e) { toast.error(friendlyError(e)); setDraft(text); }
  };

  return (
    <>
      <div className="p-3 border-b border-border">
        <div className="flex items-start gap-2">
          <Button size="icon" variant="ghost" className="h-7 w-7 sm:hidden -ml-1" onClick={onBack}><ChevronLeft className="w-4 h-4" /></Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold', intent.className)}><Icon className="w-3 h-3" /> {intent.label}</span>
              <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold', status.className)}>{status.label}</span>
              {post.status === 'pending' && requireApproval && <Badge variant="outline" className="text-[10px]">manager approval required</Badge>}
            </div>
            <p className="text-sm font-semibold mt-1">{nameOf(post.author_id)} <span className="font-normal text-muted-foreground">· {board?.role?.name} · {board?.location?.abbreviation || board?.location?.name}</span></p>
            {shift && <p className="text-xs text-muted-foreground">{post.intent === 'trade' ? 'Offering' : 'Shift'}: {fmtShift(shift)}</p>}
            {post.status === 'pending' && post.counterpart_id && (
              <p className="text-xs text-muted-foreground">
                {post.intent === 'giveaway' && <>Offered to <b>{nameOf(post.counterpart_id)}</b></>}
                {post.intent === 'trade' && <>Trading with <b>{nameOf(post.counterpart_id)}</b> for their {fmtShift(dealShift)}</>}
                {post.intent === 'pickup' && <><b>{nameOf(post.counterpart_id)}</b> offered their {fmtShift(dealShift)}</>}
              </p>
            )}
            {post.note && <p className="text-sm mt-1.5 whitespace-pre-wrap">{post.note}</p>}
          </div>
          {(mine || canModerate) && post.status === 'open' && (
            <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive gap-1 shrink-0" disabled={busy}
              onClick={() => run(() => cancelSwapPost(post.id), 'Post cancelled')}><Ban className="w-3 h-3" /> Cancel post</Button>
          )}
        </div>

        {/* deal actions */}
        {post.status === 'pending' && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {awaitingMe ? (
              <>
                <span className="text-xs text-muted-foreground mr-1">
                  {post.intent === 'trade' ? `Trade your ${fmtShift(dealShift)} for their ${fmtShift(shift)}?` : `Take the ${fmtShift(post.intent === 'pickup' ? dealShift : shift)} shift?`}
                </span>
                <Button size="sm" className="h-7 text-xs gap-1" disabled={busy}
                  onClick={() => run(() => respondToDeal(post, { accept: true, memberId: myId, requireApproval }),
                    requireApproval ? 'Accepted — sent to a manager for approval' : 'Accepted — the schedule is updated')}>
                  <Check className="w-3 h-3" /> Accept
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={busy}
                  onClick={() => run(() => respondToDeal(post, { accept: false, memberId: myId, requireApproval }), 'Declined — the post is open again')}>
                  <X className="w-3 h-3" /> Decline
                </Button>
              </>
            ) : (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Clock className="w-3 h-3" />
                {post.giveaway_request_id || post.trade_request_id ? 'Waiting on ' + (post.intent === 'pickup' ? nameOf(post.author_id) : nameOf(post.counterpart_id)) + (requireApproval ? ', then a manager' : '') : 'In progress'}
              </span>
            )}
            {(mine || post.counterpart_id === myId || canModerate) && (
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 ml-auto" disabled={busy}
                onClick={() => run(() => withdrawSwap(post.id), 'Withdrawn — the post is open again')}><Undo2 className="w-3 h-3" /> Withdraw</Button>
            )}
          </div>
        )}
        {post.status === 'open' && post.intent === 'pickup' && !mine && board?.mine && (
          <div className="mt-2"><Button size="sm" className="h-7 text-xs gap-1" onClick={() => setOfferOpen(true)}><Gift className="w-3 h-3" /> Offer one of my shifts</Button></div>
        )}
        {post.status === 'open' && post.intent !== 'pickup' && mine && repliers.length === 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">When someone replies, you’ll get a button here to {post.intent === 'giveaway' ? 'give them the shift' : 'trade with them'}.</p>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {replies.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">No replies yet.</p>}
        {replies.map(r => r.kind === 'system' ? (
          <div key={r.id} className="text-center text-[11px] text-muted-foreground px-4 py-1 flex items-center gap-2">
            <span className="flex-1 border-t border-border/60" /><span className="max-w-[80%]">{r.body}</span><span className="flex-1 border-t border-border/60" />
          </div>
        ) : (
          <div key={r.id} className={cn('group flex flex-col', r.author_id === myId ? 'items-end' : 'items-start')}>
            <span className="text-[10px] text-muted-foreground mx-1 mb-0.5">{nameOf(r.author_id)} · {format(new Date(r.created_at), 'MMM d, h:mm a')}</span>
            <div className={cn('max-w-[80%] rounded-2xl px-3 py-1.5 text-sm', r.author_id === myId ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
              {r.deleted_at ? <span className="italic opacity-60">Reply removed</span> : <span className="whitespace-pre-wrap break-words">{r.body}</span>}
            </div>
            {!r.deleted_at && (
              <div className="flex gap-2 mt-0.5 mx-1 text-[10px] text-muted-foreground opacity-60 sm:opacity-0 sm:group-hover:opacity-100">
                {post.status === 'open' && mine && post.intent === 'giveaway' && r.author_id !== myId && (
                  <button type="button" className="text-primary font-medium" disabled={busy}
                    onClick={() => run(() => initiateSwap(post.id, { counterpartId: r.author_id }), `Offered to ${nameOf(r.author_id)} — waiting for them to accept`)}>
                    <Gift className="w-3 h-3 inline" /> Give this shift to {nameOf(r.author_id)}
                  </button>
                )}
                {post.status === 'open' && mine && post.intent === 'trade' && r.author_id !== myId && (
                  <button type="button" className="text-primary font-medium" onClick={() => setPickFor(r.author_id)}>
                    <ArrowLeftRight className="w-3 h-3 inline" /> Trade with {nameOf(r.author_id)}
                  </button>
                )}
                {(r.author_id === myId || canModerate) && (
                  <button type="button" className="hover:text-destructive" disabled={busy} onClick={() => run(() => deleteSwapReply(r.id, myId))}><Trash2 className="w-3 h-3 inline" /> {r.author_id === myId ? 'delete' : 'remove'}</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {post.status === 'cancelled' ? (
        <div className="p-3 border-t border-border text-xs text-muted-foreground">This post was cancelled.</div>
      ) : (
        <div className="p-2 border-t border-border flex items-end gap-1.5">
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={1}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={post.status === 'completed' ? 'Thread is done — thanks are still welcome' : (post.intent === 'pickup' ? 'e.g. I can give you my Friday' : 'e.g. I’ll take it')}
            className="flex-1 resize-none max-h-24 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" />
          <Button size="icon" className="h-9 w-9 shrink-0" onClick={send} disabled={!draft.trim()}><Send className="w-4 h-4" /></Button>
        </div>
      )}

      {/* trade: pick their shift */}
      <ShiftPickerDialog open={!!pickFor} onClose={() => setPickFor(null)} memberId={pickFor}
        title={`Trade with ${pickFor ? nameOf(pickFor) : ''}`} description={`Pick which of their shifts you want in return for your ${fmtShift(shift)}. They’ll need to accept.`}
        meRoleIds={member?.assignedRoleIds} meLocIds={[...(member?.assignedLocationIds || []), member?.homeLocationId]}
        onPick={(sid) => run(async () => { await initiateSwap(post.id, { counterpartId: pickFor, shiftId: sid }); setPickFor(null); }, 'Trade proposed — waiting for them to accept')} />
      {/* pickup: offer my shift */}
      <ShiftPickerDialog open={offerOpen} onClose={() => setOfferOpen(false)} memberId={offerOpen ? myId : null}
        roleId={post.role_id} locationId={post.location_id}
        title={`Offer a shift to ${nameOf(post.author_id)}`} description={`Pick one of your upcoming ${board?.role?.name} shifts at ${board?.location?.name}. They’ll need to accept${requireApproval ? ', then a manager approves' : ''}.`}
        onPick={(sid) => run(async () => { await initiateSwap(post.id, { shiftId: sid }); setOfferOpen(false); }, 'Offered — waiting for them to accept')} />
    </>
  );
}

function ShiftPickerDialog({ open, onClose, memberId, roleId, locationId, meRoleIds, meLocIds, title, description, onPick }) {
  const { data: shifts = [] } = useUpcomingShifts(open ? memberId : null, { roleId, locationId });
  // for trades: only shifts I'm qualified to work (my roles + my clubs); the DB re-checks
  const options = shifts.filter(s => (!meRoleIds || meRoleIds.includes(s.roleId)) && (!meLocIds || meLocIds.includes(s.locationId)));
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-base">{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <div className="max-h-64 overflow-y-auto space-y-1.5">
          {options.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No upcoming shifts to choose from.</p>}
          {options.map(s => (
            <button key={s.id} type="button" onClick={() => onPick(s.id)} className="w-full rounded-lg border border-border px-3 py-2 text-sm text-left hover:bg-muted/50">
              {fmtShift(s)}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewPostDialog({ open, onClose, board, myId, onCreated }) {
  const [intent, setIntent] = useState('giveaway');
  const [shiftId, setShiftId] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: myShifts = [] } = useUpcomingShifts(open ? myId : null, { roleId: board.roleId, locationId: board.locationId });
  useEffect(() => { if (open) { setIntent('giveaway'); setShiftId(null); setNote(''); } }, [open]);

  const submit = async () => {
    setBusy(true);
    try {
      const id = await createSwapPost({ locationId: board.locationId, roleId: board.roleId, authorId: myId, intent, shiftId, note });
      toast.success('Posted — your board has been notified');
      onCreated(id);
    } catch (e) { toast.error(friendlyError(e)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">New post · {board.role.name} · {board.location.abbreviation || board.location.name}</DialogTitle>
          <DialogDescription>Everyone with this role at this club sees it. Keep the chatter to the shift.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2">
          {['pickup', 'giveaway', 'trade'].map(i => { const Icon = intentIcon[i]; return (
            <button key={i} type="button" onClick={() => { setIntent(i); if (i === 'pickup') setShiftId(null); }}
              className={cn('rounded-lg border px-2 py-2.5 text-xs text-left', intent === i ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted/50')}>
              <Icon className="w-4 h-4 mb-1" /><span className="font-medium block">{INTENTS[i].label}</span>
            </button>); })}
        </div>
        {intent !== 'pickup' && (
          <div>
            <Label className="text-xs">{intent === 'giveaway' ? 'Which shift are you giving away?' : 'Which shift do you want to trade?'}</Label>
            <div className="max-h-44 overflow-y-auto space-y-1.5 mt-1">
              {myShifts.length === 0 && <p className="text-xs text-muted-foreground py-2">You have no upcoming {board.role.name} shifts at {board.location.name}.</p>}
              {myShifts.map(s => (
                <button key={s.id} type="button" onClick={() => setShiftId(s.id)}
                  className={cn('w-full rounded-lg border px-3 py-2 text-sm text-left', shiftId === s.id ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted/50')}>
                  {fmtShift(s)}
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <Label className="text-xs">Note {intent === 'pickup' ? '(when can you work?)' : '(optional)'}</Label>
          <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)}
            placeholder={intent === 'pickup' ? 'e.g. Free Thu–Sun nights, happy to take any of them' : intent === 'trade' ? 'e.g. Looking for a weekend day shift in return' : 'e.g. Family thing came up'} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || (intent !== 'pickup' && !shiftId) || (intent === 'pickup' && !note.trim())} onClick={submit}>Post</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
