import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabase';

// Messaging talks to the DB directly: the tables use composite keys and
// realtime, which the base44 entity adapter isn't built for. RLS (defined in
// 20260702000006_messaging.sql + 20261004000001_messaging_moderation.sql)
// enforces all the access rules server-side — this module just issues the
// queries.

// -------------------------------------------------------------------- reads

// My conversations, each resolved with its participants + an unread flag,
// newest activity first.
export function useMyConversations(memberId) {
  return useQuery({
    queryKey: ['conversations', memberId],
    enabled: !!memberId,
    staleTime: 15000,
    queryFn: async () => {
      const { data: myParts, error: e1 } = await supabase
        .from('conversation_participants')
        .select('conversation_id, last_read_at, muted, silenced_at')
        .eq('team_member_id', memberId);
      if (e1) throw e1;
      const ids = (myParts || []).map(p => p.conversation_id);
      if (!ids.length) return [];

      const [{ data: convs, error: e2 }, { data: parts, error: e3 }] = await Promise.all([
        supabase.from('conversations')
          .select('id, conversation_type, title, location_id, role_id, last_message_at, created_by')
          .in('id', ids),
        supabase.from('conversation_participants')
          .select('conversation_id, team_member_id')
          .in('conversation_id', ids),
      ]);
      if (e2) throw e2; if (e3) throw e3;

      const mineBy = Object.fromEntries((myParts || []).map(p => [p.conversation_id, p]));
      const partsBy = {};
      (parts || []).forEach(p => { (partsBy[p.conversation_id] ||= []).push(p.team_member_id); });

      return (convs || []).map(c => {
        const mine = mineBy[c.id] || {};
        const participantIds = partsBy[c.id] || [];
        const hasUnread = !!c.last_message_at &&
          (!mine.last_read_at || new Date(c.last_message_at) > new Date(mine.last_read_at));
        return {
          ...c,
          participantIds,
          otherMemberIds: participantIds.filter(id => id !== memberId),
          muted: !!mine.muted,
          silenced: !!mine.silenced_at, // an admin has stopped me posting here
          lastReadAt: mine.last_read_at,
          hasUnread,
        };
      }).sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));
    },
  });
}

export function useMessages(conversationId) {
  return useQuery({
    queryKey: ['messages', conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('id, conversation_id, sender_team_member_id, body, mentions, deleted_at, created_at, updated_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(300);
      if (error) throw error;
      return data || [];
    },
  });
}

// Every participant row of one conversation (with mute/silence state) — for
// the Manage dialog. RLS: participants and moderators can read these.
export function useConversationParticipants(conversationId) {
  return useQuery({
    queryKey: ['conversation-participants', conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversation_participants')
        .select('team_member_id, muted, silenced_at, silenced_by, created_at')
        .eq('conversation_id', conversationId);
      if (error) throw error;
      return data || [];
    },
  });
}

// The messaging directory: coworkers I can DM + everyone in my conversations
// (for name resolution). Comes from a definer RPC because regular team members
// can't read coworkers' team_members rows through RLS. Normalized to camelCase
// to match the shape the rest of the UI expects.
export function useMessagingDirectory(memberId) {
  return useQuery({
    queryKey: ['messaging-directory', memberId],
    enabled: !!memberId,
    staleTime: 60000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('messaging_directory');
      if (error) throw error;
      return (data || []).map(m => ({
        id: m.id,
        firstName: m.first_name,
        lastName: m.last_name,
        preferredName: m.preferred_name,
        tmNumber: m.tm_number,
        homeLocationId: m.home_location_id,
        status: m.status,
        canDm: m.can_dm,
      }));
    },
  });
}

export function useMyBlocks(memberId) {
  return useQuery({
    queryKey: ['my-blocks', memberId],
    enabled: !!memberId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_blocks').select('blocked_team_member_id')
        .eq('blocker_team_member_id', memberId);
      if (error) throw error;
      return (data || []).map(b => b.blocked_team_member_id);
    },
  });
}

// Open flags I'm allowed to moderate (RLS scopes to my clubs), newest first,
// with the flagged message and its conversation embedded.
export function useOpenFlags(enabled = true) {
  return useQuery({
    queryKey: ['message-flags', 'open'],
    enabled,
    staleTime: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('message_flags')
        .select(`id, message_id, conversation_id, flagged_by, reason, created_at,
                 messages ( id, body, sender_team_member_id, deleted_at ),
                 conversations ( id, title, conversation_type, location_id, role_id )`)
        .eq('status', 'open')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

// ------------------------------------------------------------------- writes

// mentions: [{ kind: 'member'|'role'|'managers'|'all', target_id, label }]
// The server refuses @role/@all from anyone below manager, and refuses any
// send from a member an admin has silenced in that conversation.
export async function sendMessage(conversationId, senderId, body, mentions = []) {
  const text = (body || '').trim();
  if (!text) return;
  const { error } = await supabase.from('messages')
    .insert({ conversation_id: conversationId, sender_team_member_id: senderId, body: text, mentions });
  if (error) throw error;
}

export async function markRead(conversationId, memberId) {
  await supabase.from('conversation_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId).eq('team_member_id', memberId);
}

export async function setMuted(conversationId, memberId, muted) {
  await supabase.from('conversation_participants')
    .update({ muted })
    .eq('conversation_id', conversationId).eq('team_member_id', memberId);
}

// Admin mute: the member keeps reading the thread but can't post until unmuted.
export async function setSilenced(conversationId, memberId, silenced, byId) {
  const { error } = await supabase.from('conversation_participants')
    .update(silenced
      ? { silenced_at: new Date().toISOString(), silenced_by: byId }
      : { silenced_at: null, silenced_by: null })
    .eq('conversation_id', conversationId).eq('team_member_id', memberId);
  if (error) throw error;
}

export async function softDeleteMessage(messageId, memberId) {
  const { error } = await supabase.from('messages')
    .update({ deleted_at: new Date().toISOString(), deleted_by: memberId })
    .eq('id', messageId);
  if (error) throw error;
}

export async function flagMessage({ messageId, conversationId, byId, reason }) {
  const { error } = await supabase.from('message_flags')
    .insert({ message_id: messageId, conversation_id: conversationId, flagged_by: byId, reason: reason?.trim() || null });
  if (error) throw error;
}

// status: 'dismissed' | 'removed' | 'muted' — the caller performs the matching
// action (soft-delete / silence) alongside this so the flag records the outcome.
export async function resolveFlag(flagId, status, byId) {
  const { error } = await supabase.from('message_flags')
    .update({ status, reviewed_by: byId, reviewed_at: new Date().toISOString() })
    .eq('id', flagId);
  if (error) throw error;
}

// find-or-create a direct conversation between me and another member
export async function startDM(myId, otherId) {
  const { data: mine } = await supabase.from('conversation_participants')
    .select('conversation_id').eq('team_member_id', myId);
  const myIds = (mine || []).map(p => p.conversation_id);
  if (myIds.length) {
    const { data: directs } = await supabase.from('conversations')
      .select('id').eq('conversation_type', 'direct').in('id', myIds);
    for (const c of (directs || [])) {
      const { data: ps } = await supabase.from('conversation_participants')
        .select('team_member_id').eq('conversation_id', c.id);
      const ids = (ps || []).map(p => p.team_member_id);
      if (ids.length === 2 && ids.includes(otherId)) return c.id; // reuse existing DM
    }
  }
  const { data: conv, error } = await supabase.from('conversations')
    .insert({ conversation_type: 'direct' }).select('id').single(); // created_by set by trigger
  if (error) throw error;
  const { error: e2 } = await supabase.from('conversation_participants').insert([
    { conversation_id: conv.id, team_member_id: myId },
    { conversation_id: conv.id, team_member_id: otherId },
  ]);
  if (e2) throw e2;
  return conv.id;
}

// Groups carry a club so moderation and @mentions stay property-specific.
export async function createGroup(title, memberIds, myId, locationId = null) {
  const { data: conv, error } = await supabase.from('conversations')
    .insert({ conversation_type: 'group', title: title?.trim() || 'New group', location_id: locationId || null })
    .select('id').single();
  if (error) throw error;
  const rows = [...new Set([myId, ...memberIds])].map(id => ({ conversation_id: conv.id, team_member_id: id }));
  const { error: e2 } = await supabase.from('conversation_participants').insert(rows);
  if (e2) throw e2;
  return conv.id;
}

export async function updateGroup(conversationId, { title, locationId }) {
  const patch = {};
  if (title !== undefined) patch.title = title?.trim() || 'Group';
  if (locationId !== undefined) patch.location_id = locationId || null;
  const { error } = await supabase.from('conversations').update(patch).eq('id', conversationId);
  if (error) throw error;
}

export async function addParticipants(conversationId, memberIds) {
  if (!memberIds?.length) return;
  const { error } = await supabase.from('conversation_participants')
    .insert(memberIds.map(id => ({ conversation_id: conversationId, team_member_id: id })));
  if (error) throw error;
}

export async function removeParticipant(conversationId, memberId) {
  const { error } = await supabase.from('conversation_participants').delete()
    .eq('conversation_id', conversationId).eq('team_member_id', memberId);
  if (error) throw error;
}

export async function blockMember(myId, otherId) {
  const { error } = await supabase.from('member_blocks')
    .insert({ blocker_team_member_id: myId, blocked_team_member_id: otherId });
  if (error) throw error;
}

export async function unblockMember(myId, otherId) {
  await supabase.from('member_blocks').delete()
    .eq('blocker_team_member_id', myId).eq('blocked_team_member_id', otherId);
}
