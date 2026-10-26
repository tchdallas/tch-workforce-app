import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabase';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { invalidateNavBadges } from '@/hooks/useNavBadges';
import { notificationLink } from '@/lib/notificationLink';
import { toast } from 'sonner';

// Live in-app notifications: subscribes to the member's notification stream
// over Supabase Realtime — new rows pop a toast and refresh the bell instantly.
export default function useRealtimeNotifications() {
  const { member } = useCurrentMember();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // iOS (especially installed-to-home-screen) freezes the app when hidden:
  // the realtime socket dies and cached counts go stale. When the app wakes,
  // refetch every badge source immediately and rebuild the subscription
  // (bumping `wake` re-runs the channel effect with fresh auth).
  const [wake, setWake] = useState(0);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['unread-messages'] });
      invalidateNavBadges(queryClient);
      setWake((w) => w + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [queryClient]);

  useEffect(() => {
    if (!member?.id) return;
    let channel;
    let cancelled = false;
    (async () => {
      // the realtime socket must carry the user's token BEFORE subscribing —
      // otherwise RLS filters every event and the channel stays silently empty
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled || !session) return;
      supabase.realtime.setAuth(session.access_token);
      channel = supabase
        .channel(`notifications-${member.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `recipient_team_member_id=eq.${member.id}`,
          },
          (payload) => {
            queryClient.invalidateQueries({ queryKey: ['notifications'] });
            // message notifications also bump the Messages nav bubble live
            if (payload.new.type === 'message_received' || payload.new.type === 'message_mentioned') {
              queryClient.invalidateQueries({ queryKey: ['unread-messages'] });
            }
            // a flag landed in this admin's review inbox
            if (payload.new.type === 'message_flagged') {
              queryClient.invalidateQueries({ queryKey: ['message-flags'] });
            }
            // swap board activity (post/offer/accept/decline) — refresh the tiles
            if ((payload.new.type || '').startsWith('swap_')) {
              queryClient.invalidateQueries({ queryKey: ['swap-posts'] });
              queryClient.invalidateQueries({ queryKey: ['swap-replies'] });
            }
            // A notification means someone ELSE changed something that concerns
            // me — refresh the screens that show it, so their change appears in
            // seconds instead of waiting out the cache.
            const REFRESH_BY_TYPE = {
              schedule_updated: [['schedule-shifts'], ['dashboard-shifts']],
              upcoming_shift: [['schedule-shifts'], ['dashboard-shifts']],
              shift_offered: [['swap-posts'], ['schedule-shifts'], ['dashboard-shifts']],
              callout: [['all-callouts'], ['dashboard-callouts']],
              request_status: [['schedule-shifts'], ['dashboard-shifts']],
              announcement: [['my-announcements']],
              attendance_point_issued: [['my-infractions'], ['attendance-roster']],
              attendance_point_excused: [['my-infractions'], ['attendance-roster']],
              attendance_appeal_filed: [['attendance-appeals']],
              attendance_appeal_decided: [['my-infractions'], ['attendance-roster']],
              discipline_issued: [['my-discipline-docs'], ['discipline-docs']],
              discipline_draft: [['discipline-docs'], ['attendance-autodrafts']],
              discipline_signed: [['discipline-docs']],
              discipline_refused: [['discipline-docs']],
              timesheet: [['my-pending-time-entries']],
              feedback_reply: [['bug-report-comments'], ['bug-reports']],
              feedback_status: [['bug-reports']],
            };
            (REFRESH_BY_TYPE[payload.new.type] || []).forEach((key) =>
              queryClient.invalidateQueries({ queryKey: key }));
            // my messaging mute changed — swap the composer for the banner (or back)
            if (payload.new.type === 'messaging_muted' || payload.new.type === 'messaging_unmuted') {
              queryClient.invalidateQueries({ queryKey: ['messaging-mutes'] });
            }
            // realtime payloads carry raw snake_case columns
            const link = notificationLink({
              relatedEntityType: payload.new.related_entity_type,
              relatedEntityId: payload.new.related_entity_id,
              type: payload.new.type,
            });
            toast(payload.new.title, {
              description: payload.new.message,
              duration: 6000,
              ...(link ? { action: { label: 'View', onClick: () => navigate(link) } } : {}),
            });
          }
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [member?.id, queryClient, navigate, wake]);
}
