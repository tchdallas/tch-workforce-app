-- =============================================================================
-- Time-clock hardening:
-- 1) Forgotten punches auto-close: a cron job (every 30 min) closes entries
--    left open long past their shift end (or 14h for unscheduled), flags them
--    for review, and notifies managers at that location.
-- 2) Callouts interact with the clock: submitting a callout clocks the member
--    out if they are currently punched in on that shift (mid-shift sick exit).
-- =============================================================================

alter table public.time_entries add column auto_closed boolean not null default false;

create or replace function private.close_forgotten_punches()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
  r record;
  who text;
begin
  for e in
    select te.id, te.team_member_id, te.location_id, te.clock_in, s.end_at as shift_end
    from public.time_entries te
    left join public.shifts s on s.id = te.shift_id
    where te.clock_out is null
      and (
        (s.id is not null and now() > s.end_at + interval '4 hours')
        or (s.id is null and now() > te.clock_in + interval '14 hours')
      )
  loop
    update public.time_entries
    set clock_out   = coalesce(e.shift_end, e.clock_in + interval '12 hours'),
        auto_closed = true,
        edit_note   = 'Auto-closed — no clock-out recorded. Verify actual end time.'
    where id = e.id;

    select coalesce(nullif(tm.preferred_name, ''), tm.first_name) || ' ' || tm.last_name
    into who from public.team_members tm where tm.id = e.team_member_id;

    for r in
      select tm.id from public.team_members tm
      where tm.status = 'active'
        and private.permission_rank(tm.permission_level) >= private.permission_rank('manager')
        and (
          private.permission_rank(tm.permission_level) >= private.permission_rank('corporate_admin')
          or tm.home_location_id = e.location_id
          or exists (
            select 1 from public.team_member_locations x
            where x.team_member_id = tm.id and x.location_id = e.location_id
          )
        )
    loop
      perform private.notify(
        r.id, 'timesheet',
        'Missing clock-out: ' || who,
        who || ' never clocked out (in since '
          || to_char(e.clock_in at time zone 'America/Chicago', 'Mon FMDD, FMHH12:MI AM')
          || '). The entry was auto-closed — verify it in Timesheets.',
        'TimeEntry', e.id
      );
    end loop;
  end loop;
end;
$$;

-- run every 30 minutes
create extension if not exists pg_cron;
select cron.schedule('close-forgotten-punches', '*/30 * * * *',
  'select private.close_forgotten_punches()');

-- A callout clocks the member out when they're currently punched in on that
-- shift — or punched in unscheduled while the called-out shift is running now.
create or replace function private.callout_clock_out()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.time_entries te
  set clock_out = now(),
      edit_note = 'Clocked out by callout'
  where te.team_member_id = new.team_member_id
    and te.clock_out is null
    and (
      te.shift_id = new.shift_id
      or (
        te.shift_id is null
        and exists (
          select 1 from public.shifts s
          where s.id = new.shift_id
            and now() between s.start_at - interval '1 hour' and s.end_at
        )
      )
    );
  return null;
end;
$$;

create trigger zz_callout_clock_out after insert on public.callouts
  for each row execute function private.callout_clock_out();
