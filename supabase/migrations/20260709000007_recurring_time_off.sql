-- =============================================================================
-- Recurring time off: a member (or manager) can request a standing weekly
-- absence — e.g. "Mondays off from Jul 1 until Dec 1" or indefinitely. Managers
-- approve it like any time off, and can force-stop it by setting an end date /
-- cancelling. Feeds the scheduler's "unavailable" signal.
--
-- Modeled on the existing one-time time_off_requests: start_at = effective from,
-- end_at = until (now NULLABLE = indefinite), plus a weekly recurrence + weekday.
-- =============================================================================

alter table public.time_off_requests
  add column if not exists recurrence text not null default 'one_time'
    check (recurrence in ('one_time', 'weekly')),
  add column if not exists weekday smallint check (weekday between 0 and 6); -- 0 = Sunday

-- end_at may now be null (indefinite recurring). Relax the old
-- "end_at > start_at" check to allow it.
do $$
declare cname text;
begin
  select conname into cname from pg_constraint
  where conrelid = 'public.time_off_requests'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%end_at%>%start_at%';
  if cname is not null then execute format('alter table public.time_off_requests drop constraint %I', cname); end if;
end $$;

alter table public.time_off_requests alter column end_at drop not null;

alter table public.time_off_requests drop constraint if exists time_off_end_after_start;
alter table public.time_off_requests
  add constraint time_off_end_after_start check (end_at is null or end_at > start_at);

-- a weekly request must name its weekday
alter table public.time_off_requests drop constraint if exists time_off_weekly_needs_weekday;
alter table public.time_off_requests
  add constraint time_off_weekly_needs_weekday
  check (recurrence <> 'weekly' or weekday is not null);
