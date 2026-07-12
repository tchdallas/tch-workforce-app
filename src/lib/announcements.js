import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabase';

// Announcements talk to the DB directly (recipient snapshots + a publish RPC).
// RLS + publish_announcement()/announcement_ack_status() (in
// 20260703000016_announcements.sql) enforce every access rule server-side.

// -------------------------------------------------------------------- reads

// Announcements addressed to me, newest first, each with my acknowledgment
// state. (RLS only returns published ones I'm a recipient of.)
export function useMyAnnouncements(memberId) {
  return useQuery({
    queryKey: ['my-announcements', memberId],
    enabled: !!memberId,
    staleTime: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('announcement_recipients')
        .select('acknowledged_at, announcements(id, title, body, requires_acknowledgment, published_at, created_by, audience_type, location_id, role_id)')
        .eq('team_member_id', memberId);
      if (error) throw error;
      return (data || [])
        .filter(r => r.announcements) // guard drafts / RLS edge
        .map(r => ({ ...r.announcements, acknowledgedAt: r.acknowledged_at }))
        .sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));
    },
  });
}

// Announcements I've sent (or moderate), newest first, with published state.
export function useSentAnnouncements(memberId) {
  return useQuery({
    queryKey: ['sent-announcements', memberId],
    enabled: !!memberId,
    staleTime: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('announcements')
        .select('id, title, body, audience_type, location_id, role_id, requires_acknowledgment, published_at, created_at, created_by')
        .eq('created_by', memberId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

// Acknowledgment roster for one announcement (sender/moderator only, via RPC).
export function useAckStatus(announcementId) {
  return useQuery({
    queryKey: ['announcement-ack', announcementId],
    enabled: !!announcementId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('announcement_ack_status', { aid: announcementId });
      if (error) throw error;
      const rows = data || [];
      return {
        rows,
        total: rows.length,
        acknowledged: rows.filter(r => r.acknowledged_at).length,
      };
    },
  });
}

// ------------------------------------------------------------------- writes

// Create a draft and immediately publish it (snapshots recipients).
export async function createAnnouncement({ title, body, audienceType, locationId, roleId, requiresAcknowledgment }) {
  const insert = {
    title: title?.trim(),
    body: body?.trim(),
    audience_type: audienceType,
    location_id: audienceType === 'location' ? locationId : null,
    role_id: audienceType === 'role' ? roleId : null,
    requires_acknowledgment: !!requiresAcknowledgment,
  };
  const { data: row, error } = await supabase
    .from('announcements').insert(insert).select('id').single();
  if (error) throw error;
  const { error: e2 } = await supabase.rpc('publish_announcement', { aid: row.id });
  if (e2) throw e2;
  return row.id;
}

export async function acknowledgeAnnouncement(announcementId, memberId) {
  const { error } = await supabase
    .from('announcement_recipients')
    .update({ acknowledged_at: new Date().toISOString() })
    .eq('announcement_id', announcementId)
    .eq('team_member_id', memberId);
  if (error) throw error;
}
