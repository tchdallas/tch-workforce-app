-- Fix: corporate_admin+ see all time entries (including ones without a
-- location, which happens when a kiosk account has no home location set)

drop policy "time_entries_select" on public.time_entries;
create policy "time_entries_select" on public.time_entries
  for select to authenticated
  using (
    team_member_id = private.current_team_member_id()
    or (select private.is_at_least('corporate_admin'))
    or (
      (select private.is_at_least('manager'))
      and (
        (location_id is not null and private.has_location_access(location_id))
        or private.shares_location_with(team_member_id)
      )
    )
  );

drop policy "time_entries_update" on public.time_entries;
create policy "time_entries_update" on public.time_entries
  for update to authenticated
  using (
    (select private.is_at_least('corporate_admin'))
    or (
      (select private.is_at_least('manager'))
      and (
        (location_id is not null and private.has_location_access(location_id))
        or private.shares_location_with(team_member_id)
      )
    )
  )
  with check (
    (select private.is_at_least('corporate_admin'))
    or (
      (select private.is_at_least('manager'))
      and (
        (location_id is not null and private.has_location_access(location_id))
        or private.shares_location_with(team_member_id)
      )
    )
  );
