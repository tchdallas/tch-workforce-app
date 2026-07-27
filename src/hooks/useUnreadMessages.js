import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabase';
import { useCurrentMember } from '@/hooks/useCurrentMember';

// Count of conversations with unread messages — drives the bubble on the
// Messages nav item. Refreshed by polling plus invalidation from
// useRealtimeNotifications (a message notification arriving bumps it live)
// and from Messages.jsx marking a thread read.
export default function useUnreadMessages() {
  const { member } = useCurrentMember();
  const { data: count = 0 } = useQuery({
    queryKey: ['unread-messages', member?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('unread_message_count');
      if (error) throw error;
      return data || 0;
    },
    enabled: !!member?.id,
    refetchInterval: 30000,
  });
  return count;
}
