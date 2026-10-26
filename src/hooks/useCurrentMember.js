import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';

const MANAGER_LEVELS = new Set(['super_admin', 'corporate_admin', 'location_admin', 'manager', 'scheduler']);
const ADMIN_LEVELS = new Set(['super_admin', 'corporate_admin', 'location_admin']);
// Company-wide roles see every location; everyone else is scoped to the
// locations assigned to them (location_admin, manager, scheduler, team_member).
const ALL_LOCATION_LEVELS = new Set(['super_admin', 'corporate_admin']);

// Permission hierarchy — mirrors private.permission_rank() in the database.
// You may only discipline/manage people strictly BELOW your own rank.
const PERMISSION_RANK = {
  super_admin: 6, corporate_admin: 5, location_admin: 4, manager: 3, scheduler: 2, team_member: 1,
};

export function useCurrentMember() {
  const { user } = useAuth();

  // own row only, under its own cache key — this hook previously shared the
  // ['teamMembers'] key with the roster query but fetched UNFILTERED, so
  // whichever ran last overwrote the other (archived members leaked into
  // every list). RLS always allows reading your own row.
  // Look up by the auth-account LINK (user_id), not by email: auth emails are
  // stored lowercase, so an email saved as "Name@..." in the profile made this
  // lookup miss entirely — and the old "no member yet = manager" default then
  // dressed a team member in the full admin UI (RLS still blocked everything,
  // but the menus were wrong). user_id is set by DB trigger and can't drift.
  const { data: rows = [], isFetched } = useQuery({
    queryKey: ['current-member', user?.id],
    queryFn: () => base44.entities.TeamMember.filter({ userId: user.id }),
    enabled: !!user?.id,
    placeholderData: [],
  });

  const member = rows[0] || null;

  // Optimistic ONLY while the lookup is in flight (so real managers get no
  // flash of a stripped menu); once it settles with no row, show the least
  // privileged view — never default anyone INTO manager chrome.
  const isManager = member ? MANAGER_LEVELS.has(member.permissionLevel) : !isFetched;
  // strict (false while loading): used to hide admin-only UI, so no flash of access
  const isAdmin = !!member && ADMIN_LEVELS.has(member?.permissionLevel);
  const isTeamMember = !!member && !MANAGER_LEVELS.has(member?.permissionLevel);
  const permissionLevel = member?.permissionLevel || null;
  const assignedLocationIds = member?.assignedLocationIds || [];

  // Can this user act across every location? True for company-wide roles, and
  // optimistically true while the member row is still loading (so admins don't
  // see a flash of empty pickers); location-scoped roles narrow once loaded.
  const canSeeAllLocations = member ? ALL_LOCATION_LEVELS.has(member.permissionLevel) : !isFetched;

  // Filter a list of locations down to the ones this user may manage. Company
  // -wide roles get everything; everyone else only their assigned locations.
  const scopeLocations = (list = []) =>
    canSeeAllLocations ? list : list.filter(l => assignedLocationIds.includes(l.id));

  // Rank + "can I discipline someone at this level?" — strictly-higher only.
  // Mirrors private.can_discipline_member()'s rank test (the DB is authoritative;
  // this just keeps the UI honest). Loading (no member) → false, no flash of access.
  const rank = PERMISSION_RANK[permissionLevel] || 0;
  const outranks = (targetLevel) => !!member && rank > (PERMISSION_RANK[targetLevel] || 0);

  return {
    member, isManager, isAdmin, isTeamMember, permissionLevel,
    assignedLocationIds, canSeeAllLocations, scopeLocations, rank, outranks,
  };
}