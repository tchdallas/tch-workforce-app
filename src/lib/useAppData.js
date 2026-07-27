import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

// Static reference data (locations, roles) — rarely change, cache for 10 min, gc 60 min
const STATIC_OPTIONS = {
  staleTime: 10 * 60 * 1000,
  gcTime: 60 * 60 * 1000,
};

// Semi-static data — 2 min stale, 30 min cache
const SEMI_STATIC = {
  staleTime: 2 * 60 * 1000,
  gcTime: 30 * 60 * 1000,
};

// Active/live data — 1 min stale, 10 min cache
const LIVE_OPTIONS = {
  staleTime: 60 * 1000,
  gcTime: 10 * 60 * 1000,
};

// Does accepting a trade/giveaway of a shift at this location require manager
// approval? Mirrors the database's shift_swap_approval routing trigger
// (location-scoped setting overrides company; absent = no approval).
export function swapApprovalRequired(settings, locationId) {
  const val =
    (locationId && settings.find(s => s.key === 'shift_swap_approval' && s.scope === 'location' && s.locationId === locationId)?.value)
    || settings.find(s => s.key === 'shift_swap_approval' && s.scope === 'company')?.value;
  return val?.mode === 'all' || val?.mode === 'roles';
}

// The hour a "business day" starts (0 = midnight). Location setting overrides
// company. Shifts starting before this hour group with the previous day.
export function businessDayStartHour(settings, locationId) {
  const val =
    (locationId && settings.find(s => s.key === 'business_day_start_hour' && s.scope === 'location' && s.locationId === locationId)?.value)
    ?? settings.find(s => s.key === 'business_day_start_hour' && s.scope === 'company')?.value;
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n >= 0 && n <= 12 ? n : 0;
}

// Each club orders the positions on its schedule grid by relevance/need.
// Location-scoped setting holding an ordered array of role ids. Unlike the
// global roles.display_order, this is per-club — the same role can sit near
// the top at one room and near the bottom at another.
export function scheduleRoleOrder(settings, locationId) {
  if (!locationId) return [];
  const val = settings.find(
    s => s.key === 'schedule_role_order' && s.scope === 'location' && s.locationId === locationId
  )?.value;
  return Array.isArray(val) ? val.filter(id => typeof id === 'string') : [];
}

// Apply a club's order to a role list. Roles missing from the saved order
// (newly created, or never sorted here) keep their incoming display_order and
// fall in behind the ordered ones — a new role is never hidden or jumped to top.
export function sortRolesByOrder(roles, order) {
  if (!order?.length) return roles;
  const rank = new Map(order.map((id, i) => [id, i]));
  // Array.sort is stable, so unranked roles hold their relative display_order
  return [...roles].sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}

export function useLocations() {
  return useQuery({
    queryKey: ['locations'],
    queryFn: () => base44.entities.Location.list(),
    placeholderData: [],
    ...STATIC_OPTIONS,
  });
}

export function useRoles() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: () => base44.entities.Role.list('displayOrder'),
    placeholderData: [],
    ...STATIC_OPTIONS,
  });
}

// Par staffing-plan templates (named, location-wide). Scheduler+ read.
export function useParTemplates() {
  return useQuery({
    queryKey: ['par-templates'],
    queryFn: () => base44.entities.ParTemplate.filter({ status: 'active' }, 'name'),
    placeholderData: [],
    ...SEMI_STATIC,
  });
}

// Par windows (target headcount per template/role/gaming-day/time window).
export function usePars() {
  return useQuery({
    queryKey: ['par-levels'],
    queryFn: () => base44.entities.ParLevel.list('dayOfWeek'),
    placeholderData: [],
    ...SEMI_STATIC,
  });
}

export function useTeamMembers() {
  return useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.filter(
      { status: { $in: ['active', 'invited', 'inactive'] } },
      'firstName'
      // no limit: the data layer pages through everything (1,000+ members)
    ),
    placeholderData: [],
    staleTime: 0,
    gcTime: 10 * 60 * 1000,
  });
}

// Paginated/filtered team members for large lists (Team Members page)
export function useTeamMembersPaged({ status, search, limit = 100, skip = 0 } = {}) {
  const filter = {};
  if (status && status !== 'all') filter.status = status;
  return useQuery({
    queryKey: ['teamMembers-paged', status, search, limit, skip],
    queryFn: () => base44.entities.TeamMember.filter(filter, 'firstName', limit, skip),
    placeholderData: [],
    ...SEMI_STATIC,
  });
}

// Shifts are always fetched scoped to a date window — never load all shifts
export function useShifts(filters) {
  return useQuery({
    queryKey: ['shifts', filters],
    queryFn: () => base44.entities.Shift.filter(filters || {}),
    placeholderData: [],
    enabled: !!filters,
    ...LIVE_OPTIONS,
  });
}

export function useNotifications(teamMemberId) {
  return useQuery({
    queryKey: ['notifications', teamMemberId],
    queryFn: () => base44.entities.Notification.filter(
      { recipientTeamMemberId: teamMemberId, readStatus: false },
      '-created_date',
      50
    ),
    placeholderData: [],
    enabled: !!teamMemberId,
    ...LIVE_OPTIONS,
  });
}

export function useCallouts(filters) {
  return useQuery({
    queryKey: ['callouts', filters],
    queryFn: () => base44.entities.Callout.filter(filters || {}, '-created_date', 200),
    placeholderData: [],
    ...LIVE_OPTIONS,
  });
}

export function useTimeOffRequests(filters) {
  return useQuery({
    queryKey: ['timeOffRequests', filters],
    queryFn: () => base44.entities.TimeOffRequest.filter(filters || {}, '-startDateTime', 200),
    placeholderData: [],
    ...LIVE_OPTIONS,
  });
}

export function useAvailability(teamMemberId) {
  return useQuery({
    queryKey: ['availability', teamMemberId],
    queryFn: () => base44.entities.Availability.filter({ teamMemberId }),
    placeholderData: [],
    enabled: !!teamMemberId,
    ...SEMI_STATIC,
  });
}

// All recurring availability the viewer can see (RLS scopes it to their
// locations) — used to recommend/mark candidates when filling shifts.
export function useAllAvailability() {
  return useQuery({
    queryKey: ['availability-all'],
    queryFn: () => base44.entities.Availability.list(),
    placeholderData: [],
    ...SEMI_STATIC,
  });
}

// Approved time off (date-specific hard un-availability) for scheduling checks.
export function useApprovedTimeOff() {
  return useQuery({
    queryKey: ['approved-time-off'],
    queryFn: () => base44.entities.TimeOffRequest.filter({ status: 'approved' }),
    placeholderData: [],
    ...SEMI_STATIC,
  });
}

// Minimum rest between two shifts (hours) before the scheduler flags them as
// "too close". Location setting overrides company; default 8.
export function restGapHours(settings, locationId) {
  const val =
    (locationId && settings.find(s => s.key === 'min_rest_hours' && s.scope === 'location' && s.locationId === locationId)?.value)
    ?? settings.find(s => s.key === 'min_rest_hours' && s.scope === 'company')?.value;
  const n = parseFloat(val);
  return Number.isFinite(n) && n >= 0 ? n : 8;
}