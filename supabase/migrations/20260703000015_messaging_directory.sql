-- =============================================================================
-- Messaging directory RPC
--
-- Regular team members can't read coworkers' team_members rows (RLS:
-- can_view_member = self or can_manage_member). So the Messages UI can't
-- resolve coworker names or list DM candidates from a client-side query.
--
-- This definer RPC returns exactly the members a caller may need in messaging:
--   * coworkers who share a location (active) — DM/group candidates
--   * everyone already in the caller's conversations — so names resolve even
--     for cross-location group members
-- Only safe display fields are exposed. `can_dm` marks who the caller may
-- actually start a DM with (shares a location, active, not blocked either way).
-- =============================================================================

create or replace function public.messaging_directory()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select private.current_team_member_id() as id),
  coworkers as (
    -- active members who share at least one location with me
    select tm.id, true as shares_loc
    from public.team_members tm
    where tm.id <> (select id from me)
      and tm.status = 'active'
      and exists (
        select 1
        from private.member_location_ids((select id from me)) a
        join private.member_location_ids(tm.id) b using (location_id)
      )
  ),
  convo_people as (
    -- anyone in a conversation I'm part of (for name resolution)
    select distinct p.team_member_id as id, false as shares_loc
    from public.conversation_participants p
    where p.team_member_id <> (select id from me)
      and p.conversation_id in (
        select conversation_id
        from public.conversation_participants
        where team_member_id = (select id from me)
      )
  ),
  merged as (
    select id, bool_or(shares_loc) as shares_loc
    from (select * from coworkers union all select * from convo_people) u
    group by id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', tm.id,
    'first_name', tm.first_name,
    'last_name', tm.last_name,
    'preferred_name', tm.preferred_name,
    'tm_number', tm.tm_number,
    'home_location_id', tm.home_location_id,
    'status', tm.status,
    'can_dm', m.shares_loc
      and tm.status = 'active'
      and not private.blocked_between(tm.id, (select id from me))
  ) order by coalesce(nullif(tm.preferred_name, ''), tm.first_name), tm.last_name), '[]'::jsonb)
  from merged m
  join public.team_members tm on tm.id = m.id;
$$;

grant execute on function public.messaging_directory() to authenticated;
