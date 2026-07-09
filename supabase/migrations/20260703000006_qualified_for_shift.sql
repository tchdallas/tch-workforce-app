-- Members can't read coworkers' role/location assignments (by design), so the
-- give/trade modal couldn't compute who qualifies for a shift. This definer
-- function answers that one question safely: active members holding the
-- shift's role at the shift's location who aren't blocked from accepting.
-- It exposes only ids and display names — the same as the directory view.

create or replace function public.qualified_for_shift(p_shift_id uuid)
returns table (id uuid, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select tm.id,
         coalesce(tm.preferred_name, tm.first_name) || ' ' || tm.last_name
  from public.shifts s
  join public.team_members tm on tm.status = 'active' and not tm.no_shift_swap_receive
  where s.id = p_shift_id
    and exists (
      select 1 from public.team_member_roles r
      where r.team_member_id = tm.id and r.role_id = s.role_id
    )
    and (
      tm.home_location_id = s.location_id
      or exists (
        select 1 from public.team_member_locations l
        where l.team_member_id = tm.id and l.location_id = s.location_id
      )
    )
  order by 2;
$$;

grant execute on function public.qualified_for_shift(uuid) to authenticated;
