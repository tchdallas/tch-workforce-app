import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabase';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { toast } from 'sonner';

// Live in-app notifications: subscribes to the member's notification stream
// over Supabase Realtime — new rows pop a toast and refresh the bell instantly.
export default function useRealtimeNotifications() {
  const { member } = useCurrentMember();
  const queryClient = useQueryClient();

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
            toast(payload.new.title, { description: payload.new.message, duration: 6000 });
          }
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [member?.id, queryClient]);
}
