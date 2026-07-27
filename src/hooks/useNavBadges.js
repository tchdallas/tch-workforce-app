import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabase';
import { base44 } from '@/api/base44Client';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import { useNotifications } from '@/lib/useAppData';
import { useOutstandingPolicyAcks } from '@/lib/policies';
import { useMyPendingTimeEntries } from '@/lib/timesheets';

// One source of truth for every count bubble, so the total on the hamburger can
// never disagree with the numbers inside the menu.
//
// Deliberately no double-counting: each item is attributed to the ONE screen
// that resolves it. Policy acknowledgments belong to /policies, not also to the
// dashboard that happens to list them.
//
// The personal queries reuse the exact keys and fetches their owning screens
// use (ActionItems, the bell), because two useQuerys sharing a key with
// different queryFns overwrite each other's cache.

// Every cache a bubble is computed from. Call this from any action that
// resolves one — reading a notification, acknowledging a policy, approving a
// timesheet — so the count drops the moment you deal with the thing.
//
// This exists because the app sets refetchOnWindowFocus:false globally, so a
// stale badge never self-corrects: it survived until a full reload (which is
// why logging out appeared to "fix" it). Explicit invalidation is the only
// thing that clears these promptly.
export function invalidateNavBadges(qc) {
  ['notifications', 'policy-acks-outstanding', 'my-pending-time-entries',
    'my-discipline-docs', 'nav-badges-manager']
    .forEach(key => qc.invalidateQueries({ queryKey: [key] }));
}

const countOf = async (table, apply) => {
  const { count, error } = await apply(
    supabase.from(table).select('id', { count: 'exact', head: true })
  );
  if (error) throw error;
  return count || 0;
};

export function useNavBadges() {
  const { member, isManager } = useCurrentMember();
  const memberId = member?.id;
  // strict: isManager is optimistically true while the member row loads, which
  // would fire manager-only count queries for a dealer and log RLS noise
  const mgr = !!member && isManager;

  const { data: notifications = [] } = useNotifications(memberId);
  const { data: policyAcks } = useOutstandingPolicyAcks(memberId);
  const { data: pendingHours = [] } = useMyPendingTimeEntries(memberId);

  const { data: pendingDocs = [] } = useQuery({
    queryKey: ['my-discipline-docs', memberId, 'pending'],
    queryFn: () => base44.entities.DisciplineDocument.filter({ teamMemberId: memberId, status: 'issued' }),
    enabled: !!memberId,
    placeholderData: [],
  });

  // Manager queues. HEAD counts — no rows come back, and RLS scopes them to the
  // locations this manager can see, so the number matches what they'd find.
  const { data: mgrCounts = { requests: 0, timesheets: 0 } } = useQuery({
    queryKey: ['nav-badges-manager', memberId],
    enabled: mgr,
    staleTime: 60 * 1000,
    // safety net: these are HEAD counts, cheap enough to re-check when the tab
    // comes back, so a badge can't sit wrong for a day if an invalidation is missed
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const [timeOff, trades, giveaways, claims, timesheets] = await Promise.all([
        countOf('time_off_requests', q => q.eq('status', 'pending')),
        countOf('shift_trade_requests', q => q.eq('status', 'pending_manager')),
        countOf('shift_giveaway_requests', q => q.in('status', ['pending_manager', 'pending_team_member'])),
        countOf('open_shift_claims', q => q.eq('status', 'pending')),
        countOf('time_entries', q => q.eq('status', 'pending_manager')),
      ]);
      return { requests: timeOff + trades + giveaways + claims, timesheets };
    },
  });

  const policyCount =
    (policyAcks?.policies?.length || 0) + (policyAcks?.updates?.length || 0);

  const byPath = {
    '/notifications': notifications.length,
    '/policies': policyCount,
    // things only the dashboard's "Needs Your Attention" can resolve
    '/': pendingDocs.length + pendingHours.length,
    ...(mgr ? {
      '/requests': mgrCounts.requests,
      '/timesheets': mgrCounts.timesheets,
    } : {}),
  };

  const total = Object.values(byPath).reduce((sum, n) => sum + (n || 0), 0);

  return { byPath, total };
}
