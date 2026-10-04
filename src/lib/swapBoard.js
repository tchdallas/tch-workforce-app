import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabase';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { useRoles, useLocations, swapApprovalRequired } from '@/lib/useAppData';

// Swap Board data layer. Boards are (club, role) pairs. Posts and replies are
// read straight from Supabase (RLS scopes them to boards the viewer belongs to
// or manages). Deals are started through the swap_post_initiate RPC, which
// creates the real giveaway/trade request; accepting/declining updates that
// request exactly as My Schedule does, and the database mirrors the result
// back onto the tile. See 20261004000004_swap_board.sql.

export const INTENTS = {
  pickup:   { label: 'Looking to pick up', short: 'Pick up',  className: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300' },
  giveaway: { label: 'Giving away',        short: 'Giveaway', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  trade:    { label: 'Wants to trade',     short: 'Trade',    className: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300' },
};
export const STATUSES = {
  open:      { label: 'Open',      className: 'bg-emerald-500 text-white' },
  pending:   { label: 'Pending',   className: 'bg-amber-500 text-white' },
  completed: { label: 'Completed', className: 'bg-muted text-muted-foreground' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground line-through' },
};

// The boards this person can see: their own (role × club) pairs, plus — for
// managers — every active role at each club they manage.
export function useMyBoards(member, { isManager, scopeLocations }) {
  const { data: roles = [] } = useRoles();
  const { data: locations = [] } = useLocations();
  return useMemo(() => {
    if (!member) return [];
    const activeRoles = roles.filter(r => r.status !== 'archived');
    const activeLocs = locations.filter(l => l.status !== 'archived');
    const myLocIds = new Set([...(member.assignedLocationIds || []), member.homeLocationId].filter(Boolean));
    const myRoleIds = new Set(member.assignedRoleIds || []);
    const out = [];
    const push = (loc, role, mine) => {
      if (out.some(b => b.locationId === loc.id && b.roleId === role.id)) return;
      out.push({ key: `${loc.id}:${role.id}`, locationId: loc.id, roleId: role.id, location: loc, role, mine });
    };
    // mine first
    activeLocs.filter(l => myLocIds.has(l.id)).forEach(loc =>
      activeRoles.filter(r => myRoleIds.has(r.id)).forEach(role => push(loc, role, true)));
    if (isManager) {
      scopeLocations(activeLocs).forEach(loc =>
        activeRoles
          .filter(r => !r.assignedLocationIds?.length || r.assignedLocationIds.includes(loc.id))
          .forEach(role => push(loc, role, false)));
    }
    return out;
  }, [member, roles, locations, isManager, scopeLocations]);
}

export function useSwapPosts({ locationId, roleId, includeClosed }) {
  return useQuery({
    queryKey: ['swap-posts', locationId || 'all', roleId || 'all', !!includeClosed],
    enabled: !!(locationId && roleId),
    staleTime: 15000,
    queryFn: async () => {
      let q = supabase.from('swap_posts')
        .select('id, location_id, role_id, author_id, intent, shift_id, note, status, counterpart_id, deal_shift_id, giveaway_request_id, trade_request_id, completed_at, created_at, updated_at')
        .order('created_at', { ascending: false }).limit(200);
      if (locationId) q = q.eq('location_id', locationId);
      if (roleId) q = q.eq('role_id', roleId);
      if (!includeClosed) q = q.in('status', ['open', 'pending']);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });
}

export function useSwapReplies(postId) {
  return useQuery({
    queryKey: ['swap-replies', postId],
    enabled: !!postId,
    queryFn: async () => {
      const { data, error } = await supabase.from('swap_replies')
        .select('id, post_id, author_id, kind, body, deleted_at, created_at')
        .eq('post_id', postId).order('created_at', { ascending: true }).limit(300);
      if (error) throw error;
      return data || [];
    },
  });
}

// reply counts for the visible tiles, one round trip
export function useSwapReplyCounts(postIds) {
  const key = [...postIds].sort().join(',');
  return useQuery({
    queryKey: ['swap-reply-counts', key],
    enabled: postIds.length > 0,
    staleTime: 15000,
    queryFn: async () => {
      const { data, error } = await supabase.from('swap_replies')
        .select('post_id').in('post_id', postIds).eq('kind', 'reply').is('deleted_at', null);
      if (error) throw error;
      const counts = {};
      (data || []).forEach(r => { counts[r.post_id] = (counts[r.post_id] || 0) + 1; });
      return counts;
    },
  });
}

export function useSwapBoardMutes(memberId) {
  return useQuery({
    queryKey: ['swap-board-mutes'],
    enabled: !!memberId,
    staleTime: 60000,
    queryFn: async () => {
      const { data, error } = await supabase.from('swap_board_mutes').select('location_id, role_id');
      if (error) throw error;
      return data || [];
    },
  });
}

// the shifts referenced by a set of posts (poster's shift + deal shift)
export function useShiftsById(ids) {
  const clean = [...new Set(ids.filter(Boolean))].sort();
  return useQuery({
    queryKey: ['swap-shifts', clean.join(',')],
    enabled: clean.length > 0,
    staleTime: 30000,
    placeholderData: [],
    queryFn: () => base44.entities.Shift.filter({ id: { $in: clean } }),
  });
}

// a member's upcoming published shifts (for the shift pickers)
export function useUpcomingShifts(memberId, { roleId, locationId } = {}) {
  const from = format(new Date(), "yyyy-MM-dd'T'HH:mm:ss"); // local-naive, like the rest of the app
  return useQuery({
    queryKey: ['swap-upcoming-shifts', memberId, roleId || '', locationId || ''],
    enabled: !!memberId,
    staleTime: 30000,
    placeholderData: [],
    queryFn: () => base44.entities.Shift.filter({
      teamMemberId: memberId, status: 'published', startDateTime: { $gte: from },
      ...(roleId ? { roleId } : {}), ...(locationId ? { locationId } : {}),
    }, 'startDateTime', 100),
  });
}

export function useAppSettings() {
  return useQuery({
    queryKey: ['app-settings'],
    queryFn: () => base44.entities.AppSetting.list(),
    placeholderData: [],
  });
}
export { swapApprovalRequired };

// ------------------------------------------------------------------ writes

export async function createSwapPost({ locationId, roleId, authorId, intent, shiftId = null, note }) {
  const { data, error } = await supabase.from('swap_posts').insert({
    location_id: locationId, role_id: roleId, author_id: authorId, intent,
    shift_id: intent === 'pickup' ? null : shiftId, note: note?.trim() || null,
  }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function cancelSwapPost(postId) {
  const { error } = await supabase.from('swap_posts').update({ status: 'cancelled' }).eq('id', postId);
  if (error) throw error;
}

export async function updateSwapNote(postId, note) {
  const { error } = await supabase.from('swap_posts').update({ note: note?.trim() || null }).eq('id', postId);
  if (error) throw error;
}

export async function addSwapReply(postId, authorId, body) {
  const text = (body || '').trim();
  if (!text) return;
  const { error } = await supabase.from('swap_replies').insert({ post_id: postId, author_id: authorId, body: text });
  if (error) throw error;
}

export async function deleteSwapReply(replyId, byId) {
  const { error } = await supabase.from('swap_replies')
    .update({ deleted_at: new Date().toISOString(), deleted_by: byId }).eq('id', replyId);
  if (error) throw error;
}

// giveaway: initiateSwap(post.id, { counterpartId })
// trade:    initiateSwap(post.id, { counterpartId, shiftId: theirShift })
// pickup:   initiateSwap(post.id, { shiftId: myShift })
export async function initiateSwap(postId, { counterpartId = null, shiftId = null }) {
  const { error } = await supabase.rpc('swap_post_initiate', { p_post: postId, p_counterpart: counterpartId, p_shift: shiftId });
  if (error) throw error;
}

export async function withdrawSwap(postId) {
  const { error } = await supabase.rpc('swap_post_withdraw', { p_post: postId });
  if (error) throw error;
}

// The person a deal was offered to accepts or declines. Same writes My Schedule
// makes; the database routes to pending_manager when approval is required and
// transfers the shift when it isn't. The board tile follows automatically.
export async function respondToDeal(post, { accept, memberId, requireApproval }) {
  const stamp = new Date().toISOString();
  if (post.giveaway_request_id) {
    await base44.entities.ShiftGiveawayRequest.update(post.giveaway_request_id, accept
      ? { acceptingTeamMemberId: memberId, status: requireApproval ? 'pending_manager' : 'accepted', reviewedAt: stamp }
      : { status: 'denied', reviewedAt: stamp });
  } else if (post.trade_request_id) {
    await base44.entities.ShiftTradeRequest.update(post.trade_request_id,
      accept ? { status: 'approved', reviewedAt: stamp } : { status: 'denied', reviewedAt: stamp });
  }
}

export async function setBoardMuted(memberId, locationId, roleId, muted) {
  const { error } = muted
    ? await supabase.from('swap_board_mutes').insert({ team_member_id: memberId, location_id: locationId, role_id: roleId })
    : await supabase.from('swap_board_mutes').delete().eq('team_member_id', memberId).eq('location_id', locationId).eq('role_id', roleId);
  if (error) throw error;
}
