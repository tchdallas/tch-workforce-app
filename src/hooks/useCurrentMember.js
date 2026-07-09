import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';

const MANAGER_LEVELS = new Set(['super_admin', 'corporate_admin', 'location_admin', 'manager', 'scheduler']);
const ADMIN_LEVELS = new Set(['super_admin', 'corporate_admin', 'location_admin']);

export function useCurrentMember() {
  const { user } = useAuth();

  // own row only, under its own cache key — this hook previously shared the
  // ['teamMembers'] key with the roster query but fetched UNFILTERED, so
  // whichever ran last overwrote the other (archived members leaked into
  // every list). RLS always allows reading your own row.
  const { data: rows = [] } = useQuery({
    queryKey: ['current-member', user?.email],
    queryFn: () => base44.entities.TeamMember.filter({ email: user.email }),
    enabled: !!user?.email,
    placeholderData: [],
  });

  const member = rows.find(m => m.email === user?.email) || null;

  const isManager = !member || MANAGER_LEVELS.has(member?.permissionLevel);
  // strict (false while loading): used to hide admin-only UI, so no flash of access
  const isAdmin = !!member && ADMIN_LEVELS.has(member?.permissionLevel);
  const isTeamMember = !!member && !MANAGER_LEVELS.has(member?.permissionLevel);
  const assignedLocationIds = member?.assignedLocationIds || [];

  return { member, isManager, isAdmin, isTeamMember, assignedLocationIds };
}