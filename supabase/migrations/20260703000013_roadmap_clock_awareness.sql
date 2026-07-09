-- =============================================================================
-- 1) Corporate admins couldn't see time-off (and other shared-location-gated)
--    requests: shares_location_with did a raw location intersection with no
--    corporate_admin+ shortcut, unlike its sibling has_location_access. An
--    admin with no assigned locations therefore saw nothing.
-- 2) The Live Roadmap becomes time-clock aware: a definer RPC exposes who is
--    actually clocked in right now (members can't read coworkers' time_entries
--    under RLS, so the roadmap needs a sanitized feed).
-- =============================================================================

create or replace function private.shares_location_with(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.is_at_least('corporate_admin')
    or exists (
      select 1
      from private.member_location_ids(private.current_team_member_id()) a
      join private.member_location_ids(target) b using (location_id)
    );
$$;

-- Who is on the clock right now, scoped to the caller's locations
-- (corporate_admin+ see all). Only safe display fields are exposed.
create or replace function public.roadmap_clocked_in()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'team_member_id', te.team_member_id,
    'name', coalesce(nullif(tm.preferred_name, ''), tm.first_name) || ' ' || tm.last_name,
    'role_id', te.role_id,
    'role', ro.name,
    'location_id', te.location_id,
    'location', l.name,
    'clock_in', te.clock_in,
    'shift_id', te.shift_id,
    'shift_end', s.end_at,
    'unscheduled', te.shift_id is null
  ) order by te.clock_in), '[]'::jsonb)
  from public.time_entries te
  join public.team_members tm on tm.id = te.team_member_id
  left join public.roles ro on ro.id = te.role_id
  left join public.locations l on l.id = te.location_id
  left join public.shifts s on s.id = te.shift_id
  where te.clock_out is null
    and (
      private.is_at_least('corporate_admin')
      or te.location_id in (
        select location_id from private.member_location_ids(private.current_team_member_id())
      )
    );
$$;

grant execute on function public.roadmap_clocked_in() to authenticated;
