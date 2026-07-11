-- =============================================================================
-- Par levels as named, location-wide staffing-plan TEMPLATES.
--
-- A par_template ("Standard Week", "Holiday", "Big Tournament") belongs to a
-- location and holds par windows for every role. Schedulers pick a template to
-- build / compare a week against; one template per location is the default.
--
-- Windows use GAMING-DAY time (business_day_start_hour, default 4 AM):
-- end_time <= start_time runs past midnight within the same gaming day.
-- =============================================================================

create table public.par_templates (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id),
  name        text not null,
  is_default  boolean not null default false,
  status      public.record_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- at most one default template per location
create unique index par_templates_one_default
  on public.par_templates (location_id)
  where is_default and status = 'active';

create table public.par_levels (
  id             uuid primary key default gen_random_uuid(),
  template_id    uuid not null references public.par_templates (id) on delete cascade,
  role_id        uuid not null references public.roles (id),
  day_of_week    smallint not null check (day_of_week between 0 and 6), -- 0 = Sunday (gaming day)
  start_time     time not null,
  end_time       time not null, -- <= start_time -> crosses midnight within the same gaming day
  required_count smallint not null check (required_count >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index par_levels_template_idx on public.par_levels (template_id);

create trigger set_updated_at before update on public.par_templates
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.par_levels
  for each row execute function private.set_updated_at();
create trigger audit after insert or update or delete on public.par_templates
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.par_levels
  for each row execute function private.write_audit_log();

alter table public.par_templates enable row level security;
alter table public.par_levels enable row level security;

-- Templates: scheduler+ read, location_admin+ write, scoped to their locations
-- (corporate_admin+ see all via has_location_access).
create policy "par_templates_select" on public.par_templates
  for select to authenticated
  using ((select private.is_at_least('scheduler')) and private.has_location_access(location_id));
create policy "par_templates_write" on public.par_templates
  for all to authenticated
  using ((select private.is_at_least('location_admin')) and private.has_location_access(location_id))
  with check ((select private.is_at_least('location_admin')) and private.has_location_access(location_id));

-- Windows inherit access from their parent template's location.
create policy "par_levels_select" on public.par_levels
  for select to authenticated
  using (exists (
    select 1 from public.par_templates t
    where t.id = template_id
      and (select private.is_at_least('scheduler'))
      and private.has_location_access(t.location_id)
  ));
create policy "par_levels_write" on public.par_levels
  for all to authenticated
  using (exists (
    select 1 from public.par_templates t
    where t.id = template_id
      and (select private.is_at_least('location_admin'))
      and private.has_location_access(t.location_id)
  ))
  with check (exists (
    select 1 from public.par_templates t
    where t.id = template_id
      and (select private.is_at_least('location_admin'))
      and private.has_location_access(t.location_id)
  ));
