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
            if (payload.new.type === 'message_received') {
              queryClient.invalidateQueries({ queryKey: ['unread-messages'] });
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
