import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabase';

// Per-member notification preferences. Direct-supabase (upsert on the
// team_member_id + event_type unique key); RLS restricts every row to its
// owner (notification_preferences_all policy). No row for an event = enabled
// with defaults.

// Member-facing notification categories, in display order.
export const NOTIF_EVENTS = [
  { key: 'schedule_updated', label: 'Schedule changes', desc: 'New, retimed, reassigned, or cancelled shifts' },
  { key: 'upcoming_shift', label: 'Shift reminders', desc: 'A heads-up before your shift starts' },
  { key: 'shift_offered', label: 'Open shifts', desc: 'Open shifts you qualify for' },
  { key: 'request_status', label: 'Time-off decisions', desc: 'When a request is approved or denied' },
];

// Lead-time options for shift reminders (minutes).
export const LEAD_TIME_OPTIONS = [
  { minutes: 1440, label: '24 hours' },
  { minutes: 240, label: '4 hours' },
  { minutes: 120, label: '2 hours' },
  { minutes: 60, label: '1 hour' },
  { minutes: 30, label: '30 min' },
];

export const DEFAULT_LEAD_TIMES = [120];

export function useMyNotificationPrefs(memberId) {
  return useQuery({
    queryKey: ['notification-prefs', memberId],
    enabled: !!memberId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('event_type, enabled, settings')
        .eq('team_member_id', memberId);
      if (error) throw error;
      // map by event_type for easy lookup
      return Object.fromEntries((data || []).map(r => [r.event_type, r]));
    },
  });
}

export async function saveNotificationPref(memberId, eventType, { enabled, settings }) {
  const row = { team_member_id: memberId, event_type: eventType };
  if (enabled !== undefined) row.enabled = enabled;
  if (settings !== undefined) row.settings = settings;
  const { error } = await supabase
    .from('notification_preferences')
    .upsert(row, { onConflict: 'team_member_id,event_type' });
  if (error) throw error;
}
