-- =============================================================================
-- Domain 2: Scheduling
-- shifts, schedule templates, availability, blackout days
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

create type public.shift_status as enum ('draft', 'published', 'cancelled');

create type public.shift_type as enum ('assigned', 'open');

create type public.coverage_status as enum ('covered', 'coverage_needed', 'open', 'callout');

create type public.availability_type as enum ('available', 'unavailable', 'preferred');

create type public.blackout_rule_type as enum (
  'block_requests',
  'require_admin_approval',
  'warning_only'
);

-- shared by availability (this domain) and the request tables (Domain 3)
create type public.request_status as enum ('pending', 'approved', 'denied', 'cancelled');

-- -----------------------------------------------------------------------------
-- Helper: do the current user and the target member share a location?
-- (like can_manage_member, but without the manager rank floor — used to give
-- schedulers read access to availability of people at their locations)
-- -----------------------------------------------------------------------------

create or replace function private.shares_location_with(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.member_location_ids(private.current_team_member_id()) a
    join private.member_location_ids(target) b using (location_id)
  );
$$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table public.shifts (
  id                    uuid primary key default gen_random_uuid(),
  location_id           uuid not null references public.locations (id),
  role_id               uuid not null references public.roles (id),
  team_member_id        uuid references public.team_members (id), -- null = open shift
  start_at              timestamptz not null,
  end_at                timestamptz not null,
  break_minutes         integer not null default 0 check (break_minutes >= 0),
  break_note            text,
  status                public.shift_status not null default 'draft',
  shift_type            public.shift_type not null default 'assigned',
  team_facing_notes     text,
  internal_notes        text, -- scheduler+ eyes only (kept off the schedule_shifts view)
  pay_rate_used         numeric(8, 2),
  estimated_labor_cost  numeric(10, 2),
  coverage_status       public.coverage_status not null default 'covered',
  recent_change_flag    boolean not null default false,
  tags                  text[] not null default '{}',
  warnings              text[] not null default '{}',
  archived              boolean not null default false, -- ~90-day soft archive
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (end_at > start_at)
);

create index shifts_location_start_idx on public.shifts (location_id, start_at);
create index shifts_member_start_idx on public.shifts (team_member_id, start_at);
create index shifts_live_idx on public.shifts (start_at) where not archived;

create table public.schedule_templates (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id),
  name        text not null,
  description text,
  status      public.record_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- base44 embedded ScheduleTemplate.shifts array -> child table
create table public.schedule_template_shifts (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references public.schedule_templates (id) on delete cascade,
  role_id       uuid not null references public.roles (id),
  day_of_week   smallint not null check (day_of_week between 0 and 6), -- 0 = Sunday
  start_time    time not null,
  end_time      time not null, -- end <= start means the shift crosses midnight
  break_minutes integer not null default 0 check (break_minutes >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index schedule_template_shifts_template_idx
  on public.schedule_template_shifts (template_id);

-- members submit availability; a scheduler or manager approves/denies it
create table public.availability (
  id                uuid primary key default gen_random_uuid(),
  team_member_id    uuid not null references public.team_members (id) on delete cascade,
  day_of_week       smallint not null check (day_of_week between 0 and 6), -- 0 = Sunday
  availability_type public.availability_type not null default 'available',
  start_time        time, -- null start+end = the whole day
  end_time          time,
  note              text,
  status            public.request_status not null default 'pending',
  reviewed_by       uuid references public.team_members (id),
  reviewed_at       timestamptz,
  review_note       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index availability_member_idx on public.availability (team_member_id);

create table public.blackout_days (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id),
  name        text not null,
  date_start  date not null,
  date_end    date not null,
  rule_type   public.blackout_rule_type not null default 'require_admin_approval',
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (date_end >= date_start)
);

create index blackout_days_location_idx on public.blackout_days (location_id, date_start);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

create trigger set_updated_at before update on public.shifts
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.schedule_templates
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.schedule_template_shifts
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.availability
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.blackout_days
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- -----------------------------------------------------------------------------

alter table public.shifts enable row level security;
alter table public.schedule_templates enable row level security;
alter table public.schedule_template_shifts enable row level security;
alter table public.availability enable row level security;
alter table public.blackout_days enable row level security;

-- shifts: the raw table is scheduler+ at their locations only, because it holds
-- pay_rate_used / estimated_labor_cost / internal_notes / warnings. Team members
-- read published schedules through the schedule_shifts view below.
create policy "shifts_select" on public.shifts
  for select to authenticated
  using (
    (select private.is_at_least('scheduler'))
    and private.has_location_access(location_id)
  );
create policy "shifts_insert" on public.shifts
  for insert to authenticated
  with check (
    (select private.is_at_least('scheduler'))
    and private.has_location_access(location_id)
  );
create policy "shifts_update" on public.shifts
  for update to authenticated
  using (
    (select private.is_at_least('scheduler'))
    and private.has_location_access(location_id)
  )
  with check (
    (select private.is_at_least('scheduler'))
    and private.has_location_access(location_id)
  );
-- hard delete only for drafts (clearing cells while building a schedule);
-- published/cancelled shifts are never deleted, by anyone — cancel/archive instead.
-- Domain 4 attaches an audit trigger so even draft deletes are recorded.
create policy "shifts_delete" on public.shifts
  for delete to authenticated
  using (
    (select private.is_at_least('scheduler'))
    and private.has_location_access(location_id)
    and status = 'draft'
  );

-- templates: scheduler+ at their locations; archived via status, never deleted
create policy "schedule_templates_select" on public.schedule_templates
  for select to authenticated
  using (
    (select private.is_at_least('scheduler'))
    and private.has_location_access(location_id)
  );
create policy "schedule_templates_insert" on public.schedule_templates
  for insert to authenticated
  with check (
    (select private.is_at_least('scheduler'))
    and private.has_location_access(location_id)
  );
create policy "schedule_templates_update" on public.schedule_templates
  for update to authenticated
  using (
    (select private.is_at_least('scheduler'))
    and private.has_location_access(location_id)
  )
  with check (
    (select private.is_at_least('scheduler'))
    and private.has_location_access(location_id)
  );

-- template shifts inherit access from their parent template: the subquery runs
-- under the caller's RLS, so it only sees templates the caller can reach
create policy "schedule_template_shifts_all" on public.schedule_template_shifts
  for all to authenticated
  using (
    exists (
      select 1 from public.schedule_templates t
      where t.id = template_id
    )
  )
  with check (
    exists (
      select 1 from public.schedule_templates t
      where t.id = template_id
    )
  );

-- availability: members submit (always lands as 'pending'); scheduler+ at the
-- member's locations reviews (approve/deny) or enters rows directly. A member
-- editing an already-reviewed row must set it back to 'pending' (re-approval).
create policy "availability_select" on public.availability
  for select to authenticated
  using (
    team_member_id = private.current_team_member_id()
    or (
      (select private.is_at_least('scheduler'))
      and private.shares_location_with(team_member_id)
    )
  );
create policy "availability_insert" on public.availability
  for insert to authenticated
  with check (
    (team_member_id = private.current_team_member_id() and status = 'pending')
    or (
      (select private.is_at_least('scheduler'))
      and private.shares_location_with(team_member_id)
    )
  );
create policy "availability_update" on public.availability
  for update to authenticated
  using (
    team_member_id = private.current_team_member_id()
    or (
      (select private.is_at_least('scheduler'))
      and private.shares_location_with(team_member_id)
    )
  )
  with check (
    (team_member_id = private.current_team_member_id() and status = 'pending')
    or (
      (select private.is_at_least('scheduler'))
      and private.shares_location_with(team_member_id)
    )
  );
create policy "availability_delete" on public.availability
  for delete to authenticated
  using (
    team_member_id = private.current_team_member_id()
    or (
      (select private.is_at_least('scheduler'))
      and private.shares_location_with(team_member_id)
    )
  );

-- blackout days: everyone can read the rules (they gate time-off requests);
-- location_admin+ manages them for their locations
create policy "blackout_days_select" on public.blackout_days
  for select to authenticated using (true);
create policy "blackout_days_write" on public.blackout_days
  for all to authenticated
  using (
    (select private.is_at_least('location_admin'))
    and private.has_location_access(location_id)
  )
  with check (
    (select private.is_at_least('location_admin'))
    and private.has_location_access(location_id)
  );

-- -----------------------------------------------------------------------------
-- schedule_shifts view: the team-facing schedule.
-- Owned by postgres (bypasses shifts RLS) but filtered per caller inside the
-- view: published, non-archived shifts at the caller's locations, plus any
-- published shift assigned to the caller. Excludes pay, internal notes,
-- and scheduling warnings.
-- -----------------------------------------------------------------------------

create view public.schedule_shifts
with (security_barrier)
as
select
  id,
  location_id,
  role_id,
  team_member_id,
  start_at,
  end_at,
  break_minutes,
  break_note,
  status,
  shift_type,
  team_facing_notes,
  coverage_status,
  recent_change_flag,
  tags
from public.shifts
where status = 'published'
  and archived = false
  and (
    private.has_location_access(location_id)
    or team_member_id = private.current_team_member_id()
  );

revoke all on public.schedule_shifts from anon, authenticated;
grant select on public.schedule_shifts to authenticated;
