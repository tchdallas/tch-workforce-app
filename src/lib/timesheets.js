import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabase';

// Timesheet verification. Every write goes through a security-definer RPC in
// 20260725000003_timesheet_verification.sql — direct UPDATE on the clock columns
// is revoked, so there is deliberately no way to set someone's paid hours from
// here without going through the approval flow.

export const STATUS_LABEL = {
  open: 'On the clock',
  pending_manager: 'Needs your approval',
  pending_member: 'Waiting on team member',
  verified: 'Verified',
};

// ------------------------------------------------------------------- reads

// Entries where this member has been asked to confirm times a manager asserted.
export function useMyPendingTimeEntries(memberId) {
  return useQuery({
    queryKey: ['my-pending-time-entries', memberId],
    enabled: !!memberId,
    staleTime: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_entries')
        .select('id, clock_in, clock_out, proposed_clock_in, proposed_clock_out, proposal_note, proposed_at, status, manager_created, location_id, shift_id')
        .eq('team_member_id', memberId)
        .eq('status', 'pending_member')
        .order('clock_in', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

// A member's own recent entries, so they can see where each one stands.
export function useMyTimeEntries(memberId, days = 30) {
  return useQuery({
    queryKey: ['my-time-entries', memberId, days],
    enabled: !!memberId,
    staleTime: 30000,
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const { data, error } = await supabase
        .from('time_entries')
        .select('id, clock_in, clock_out, status, auto_closed, manager_created, proposal_note, proposed_clock_in, proposed_clock_out')
        .eq('team_member_id', memberId)
        .gte('clock_in', since)
        .order('clock_in', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

export function usePunchReliability(memberId, days = 90) {
  return useQuery({
    queryKey: ['punch-reliability', memberId, days],
    enabled: !!memberId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('punch_reliability', {
        p_member: memberId, p_days: days,
      });
      if (error) throw error;
      return data;
    },
  });
}

// Everyone at my locations under the threshold — the manager's coaching list.
export function usePunchReliabilityFlags({ days = 90, threshold = 90, enabled = true } = {}) {
  return useQuery({
    queryKey: ['punch-reliability-flags', days, threshold],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('punch_reliability_flags', {
        p_days: days, p_threshold: threshold,
      });
      if (error) throw error;
      return data || [];
    },
  });
}

// ------------------------------------------------------------------ writes

const call = async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(friendly(error.message));
  return data;
};

export const approveEntry = (id) => call('timesheet_approve', { eid: id });

export const proposeEntry = (id, clockIn, clockOut, note) =>
  call('timesheet_propose', {
    eid: id,
    p_in: new Date(clockIn).toISOString(),
    p_out: clockOut ? new Date(clockOut).toISOString() : null,
    p_note: note || null,
  });

export const createMissingEntry = ({ memberId, locationId, shiftId, clockIn, clockOut, note }) =>
  call('timesheet_create_missing', {
    p_member: memberId,
    p_location: locationId || null,
    p_shift: shiftId || null,
    p_in: new Date(clockIn).toISOString(),
    p_out: clockOut ? new Date(clockOut).toISOString() : null,
    p_note: note || null,
  });

export const acceptCounter = (id) => call('timesheet_accept_counter', { eid: id });

export const memberAccept = (id) => call('timesheet_member_accept', { eid: id });

export const memberCounter = (id, clockIn, clockOut, note) =>
  call('timesheet_member_counter', {
    eid: id,
    p_in: new Date(clockIn).toISOString(),
    p_out: clockOut ? new Date(clockOut).toISOString() : null,
    p_note: note || null,
  });

export const forceReminder = (id, message) =>
  call('timesheet_force_reminder', { eid: id, p_message: message || null });

export const markExported = (ids) => call('timesheet_mark_exported', { p_ids: ids });

// Postgres RAISE text is already written for humans in these functions; this
// just catches the RLS/permission cases that aren't.
function friendly(msg) {
  if (!msg) return 'Something went wrong';
  if (msg.includes('permission denied') || msg.includes('row-level security')) {
    return "You don't have permission to do that";
  }
  return msg.replace(/^.*?ERROR:\s*/i, '');
}
