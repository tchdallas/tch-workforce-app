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

// Par levels (target headcount per location/role/gaming-day/time window).
// Scheduler+ can read; RLS scopes to the viewer's locations.
export function usePars() {
  return useQuery({
    queryKey: ['par-levels'],
    queryFn: () => base44.entities.ParLevel.filter({ status: 'active' }, 'dayOfWeek'),
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