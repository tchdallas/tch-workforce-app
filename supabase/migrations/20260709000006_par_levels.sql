-- =============================================================================
-- Par levels: target headcount per location × role × gaming-day-of-week × time
-- window. The scheduler compares the published schedule against these to flag
-- under- and over-staffed windows. Greenfield — no prior staffing-target concept.
--
-- Windows are interpreted in GAMING-DAY terms (business_day_start_hour, default
-- 4 AM): e.g. a Friday 6:00 PM–2:00 AM window is one Friday gaming-day window.
-- Mirrors schedule_template_shifts: end_time <= start_time means the window
-- runs past midnight (staying within the same gaming day).
-- =============================================================================

create table public.par_levels (
  id             uuid primary key default gen_random_uuid(),
  location_id    uuid not null references public.locations (id),
  role_id        uuid not null references public.roles (id),
  day_of_week    smallint not null check (day_of_week between 0 and 6), -- 0 = Sunday (gaming day)
  start_time     time not null,
  end_time       time not null, -- <= start_time -> crosses midnight within the same gaming day
  required_count smallint not null check (required_count >= 0),
  note           text,
  status         public.record_status not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index par_levels_lookup_idx
  on public.par_levels (location_id, role_id, day_of_week)
  where status = 'active';

create trigger set_updated_at before update on public.par_levels
  for each row execute function private.set_updated_at();
create trigger audit after insert or update or delete on public.par_levels
  for each row execute function private.write_audit_log();

alter table public.par_levels enable row level security;

-- Read: scheduler+ (they build schedules against these targets), scoped to
-- their locations; corporate_admin+ see all (has_location_access shortcuts them).
create policy "par_levels_select" on public.par_levels
  for select to authenticated
  using (
    (select private.is_at_least('scheduler'))
    and private.has_location_access(location_id)
  );

-- Write (define/edit targets): location_admin+ at their locations; corporate+ all.
create policy "par_levels_write" on public.par_levels
  for all to authenticated
  using (
    (select private.is_at_least('location_admin'))
    and private.has_location_access(location_id)
  )
  with check (
    (select private.is_at_least('location_admin'))
    and private.has_location_access(location_id)
  );
