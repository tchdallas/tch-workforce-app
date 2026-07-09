-- =============================================================================
-- Domain 1: Foundation & Identity
-- locations, roles, team_members (+ junctions), pay rates, RLS helpers
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

create type public.permission_level as enum (
  'team_member',
  'scheduler',
  'manager',
  'location_admin',
  'corporate_admin',
  'super_admin'
);

create type public.member_status as enum ('invited', 'active', 'inactive', 'archived');

create type public.record_status as enum ('active', 'archived');

create type public.theme_preference as enum ('device', 'light', 'dark');

-- -----------------------------------------------------------------------------
-- Private schema for RLS helper functions (not exposed through the API)
-- -----------------------------------------------------------------------------

create schema if not exists private;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table public.locations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  abbreviation  text,
  address       text,
  city          text,
  state         text,
  zip           text,
  contact_phone text,
  timezone      text not null default 'America/Chicago',
  status        public.record_status not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.roles (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  role_group    text, -- Floor, Cage, Kitchen, Bar, Management, Other
  color         text, -- hex color for schedule visibility
  display_order integer not null default 0,
  status        public.record_status not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Locations where a role is offered. No rows = available at all locations
-- (matches base44 semantics of an empty assignedLocationIds array).
create table public.role_locations (
  role_id     uuid not null references public.roles (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  primary key (role_id, location_id)
);

create table public.team_members (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid unique references auth.users (id) on delete set null,
  tm_number               text,
  first_name              text not null,
  last_name               text not null,
  preferred_name          text,
  email                   text not null,
  phone                   text,
  date_of_birth           date,
  address                 text,
  city                    text,
  state                   text,
  zip                     text,
  home_location_id        uuid references public.locations (id),
  status                  public.member_status not null default 'active',
  profile_photo           text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  start_date              date,
  notes                   text, -- manager/admin eyes only (RLS keeps full rows away from peers)
  theme_preference        public.theme_preference not null default 'device',
  permission_level        public.permission_level not null default 'team_member',
  no_shift_swap_give      boolean not null default false, -- blocked from initiating trades/giveaways
  no_shift_swap_receive   boolean not null default false, -- blocked from accepting trades/giveaways
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index team_members_email_key on public.team_members (lower(email));
create index team_members_home_location_idx on public.team_members (home_location_id);
create index team_members_status_idx on public.team_members (status);

create table public.team_member_locations (
  team_member_id uuid not null references public.team_members (id) on delete cascade,
  location_id    uuid not null references public.locations (id) on delete cascade,
  primary key (team_member_id, location_id)
);

create index team_member_locations_location_idx on public.team_member_locations (location_id);

create table public.team_member_roles (
  team_member_id uuid not null references public.team_members (id) on delete cascade,
  role_id        uuid not null references public.roles (id) on delete cascade,
  primary key (team_member_id, role_id)
);

create index team_member_roles_role_idx on public.team_member_roles (role_id);

create table public.team_member_pay_rates (
  id             uuid primary key default gen_random_uuid(),
  team_member_id uuid not null references public.team_members (id) on delete cascade,
  location_id    uuid not null references public.locations (id) on delete cascade,
  role_id        uuid not null references public.roles (id) on delete cascade,
  pay_rate       numeric(8, 2) not null check (pay_rate >= 0),
  status         public.record_status not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (team_member_id, location_id, role_id)
);

create index team_member_pay_rates_member_idx on public.team_member_pay_rates (team_member_id);
create index team_member_pay_rates_location_idx on public.team_member_pay_rates (location_id);

-- -----------------------------------------------------------------------------
-- Helper functions
-- -----------------------------------------------------------------------------

create or replace function private.permission_rank(p public.permission_level)
returns integer
language sql
immutable
as $$
  select case p
    when 'super_admin'     then 6
    when 'corporate_admin' then 5
    when 'location_admin'  then 4
    when 'manager'         then 3
    when 'scheduler'       then 2
    else 1
  end;
$$;

create or replace function private.current_team_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from public.team_members
  where user_id = auth.uid()
    and status in ('active', 'invited');
$$;

create or replace function private.current_permission_rank()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.permission_rank(permission_level)
     from public.team_members
     where user_id = auth.uid()
       and status in ('active', 'invited')),
    0
  );
$$;

create or replace function private.is_at_least(p public.permission_level)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_permission_rank() >= private.permission_rank(p);
$$;

-- Every location a member belongs to: home location + assigned locations.
create or replace function private.member_location_ids(member uuid)
returns table (location_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select tm.home_location_id
  from public.team_members tm
  where tm.id = member and tm.home_location_id is not null
  union
  select tml.location_id
  from public.team_member_locations tml
  where tml.team_member_id = member;
$$;

-- corporate_admin+ can access any location; below that, only their own locations.
create or replace function private.has_location_access(loc uuid)
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
      from private.member_location_ids(private.current_team_member_id()) m
      where m.location_id = loc
    );
$$;

-- Managers+ can manage members who share one of their locations; corporate+ anyone.
create or replace function private.can_manage_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.is_at_least('corporate_admin') then true
    when private.is_at_least('manager') then exists (
      select 1
      from private.member_location_ids(private.current_team_member_id()) a
      join private.member_location_ids(target) b using (location_id)
    )
    else false
  end;
$$;

create or replace function private.can_view_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target = private.current_team_member_id()
      or private.can_manage_member(target);
$$;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.locations
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.roles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.team_members
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.team_member_pay_rates
  for each row execute function private.set_updated_at();

-- Auth linking, direction 1: a team_member row is created for someone who
-- already has an auth account -> link by email.
create or replace function private.link_member_to_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is null then
    select u.id into new.user_id
    from auth.users u
    where lower(u.email) = lower(new.email);
  end if;
  return new;
end;
$$;

create trigger link_member_to_auth_user before insert on public.team_members
  for each row execute function private.link_member_to_auth_user();

-- Auth linking, direction 2: someone signs up whose email matches an existing
-- (invited) team_member row -> link it.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.team_members
  set user_id = new.id
  where user_id is null
    and lower(email) = lower(new.email);
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- Guard rails that RLS policies can't express on their own:
--  * below manager, you can only edit your own personal fields
--  * nobody grants a permission level above their own
--  * nobody (below super_admin) edits a member of equal or higher level
--  * only corporate_admin+ may re-point user_id
create or replace function private.guard_team_member_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_rank integer;
  is_self boolean;
begin
  -- service_role / server-side jobs bypass the guard
  if auth.uid() is null then
    return new;
  end if;

  actor_rank := private.current_permission_rank();

  if private.permission_rank(new.permission_level) > actor_rank then
    raise exception 'Cannot grant a permission level above your own';
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  is_self := coalesce(old.user_id = auth.uid(), false);

  if new.user_id is distinct from old.user_id
     and actor_rank < private.permission_rank('corporate_admin') then
    raise exception 'Only corporate admins can re-link a member to a different account';
  end if;

  if not is_self
     and actor_rank < private.permission_rank('super_admin')
     and private.permission_rank(old.permission_level) >= actor_rank then
    raise exception 'Cannot modify a member with an equal or higher permission level';
  end if;

  if is_self and actor_rank < private.permission_rank('manager') then
    if new.tm_number         is distinct from old.tm_number
    or new.first_name        is distinct from old.first_name
    or new.last_name         is distinct from old.last_name
    or new.email             is distinct from old.email
    or new.home_location_id  is distinct from old.home_location_id
    or new.status            is distinct from old.status
    or new.notes             is distinct from old.notes
    or new.permission_level  is distinct from old.permission_level
    or new.no_shift_swap_give    is distinct from old.no_shift_swap_give
    or new.no_shift_swap_receive is distinct from old.no_shift_swap_receive
    or new.start_date        is distinct from old.start_date then
      raise exception 'You can only update your own personal details';
    end if;
  end if;

  return new;
end;
$$;

create trigger guard_team_member_write before insert or update on public.team_members
  for each row execute function private.guard_team_member_write();

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- -----------------------------------------------------------------------------

alter table public.locations enable row level security;
alter table public.roles enable row level security;
alter table public.role_locations enable row level security;
alter table public.team_members enable row level security;
alter table public.team_member_locations enable row level security;
alter table public.team_member_roles enable row level security;
alter table public.team_member_pay_rates enable row level security;

-- locations: everyone signed in can read; corporate_admin+ manages
create policy "locations_select" on public.locations
  for select to authenticated using (true);
create policy "locations_insert" on public.locations
  for insert to authenticated with check ((select private.is_at_least('corporate_admin')));
create policy "locations_update" on public.locations
  for update to authenticated
  using ((select private.is_at_least('corporate_admin')))
  with check ((select private.is_at_least('corporate_admin')));
-- no delete policy: locations are archived via status, never hard-deleted

-- roles: everyone signed in can read; location_admin+ manages
create policy "roles_select" on public.roles
  for select to authenticated using (true);
create policy "roles_insert" on public.roles
  for insert to authenticated with check ((select private.is_at_least('location_admin')));
create policy "roles_update" on public.roles
  for update to authenticated
  using ((select private.is_at_least('location_admin')))
  with check ((select private.is_at_least('location_admin')));
-- no delete policy: roles are archived via status, never hard-deleted

create policy "role_locations_select" on public.role_locations
  for select to authenticated using (true);
create policy "role_locations_write" on public.role_locations
  for all to authenticated
  using ((select private.is_at_least('location_admin')))
  with check ((select private.is_at_least('location_admin')));

-- team_members: self + managers-with-shared-location + corporate_admin+
-- (peers use the team_member_directory view instead of this table)
create policy "team_members_select" on public.team_members
  for select to authenticated
  using (private.can_view_member(id));
create policy "team_members_insert" on public.team_members
  for insert to authenticated
  with check (
    (select private.is_at_least('corporate_admin'))
    or (
      (select private.is_at_least('location_admin'))
      and home_location_id is not null
      and private.has_location_access(home_location_id)
    )
  );
create policy "team_members_update" on public.team_members
  for update to authenticated
  using (
    coalesce(user_id = (select auth.uid()), false)
    or private.can_manage_member(id)
  )
  with check (
    coalesce(user_id = (select auth.uid()), false)
    or private.can_manage_member(id)
  );
-- no delete policy: team members are archived via status, never hard-deleted

-- junctions: readable by all signed-in users (needed to render schedules/filters)
create policy "team_member_locations_select" on public.team_member_locations
  for select to authenticated using (true);
create policy "team_member_locations_write" on public.team_member_locations
  for all to authenticated
  using (
    (select private.is_at_least('corporate_admin'))
    or ((select private.is_at_least('manager')) and private.has_location_access(location_id))
  )
  with check (
    (select private.is_at_least('corporate_admin'))
    or ((select private.is_at_least('manager')) and private.has_location_access(location_id))
  );

create policy "team_member_roles_select" on public.team_member_roles
  for select to authenticated using (true);
create policy "team_member_roles_write" on public.team_member_roles
  for all to authenticated
  using (
    (select private.is_at_least('corporate_admin'))
    or ((select private.is_at_least('manager')) and private.can_manage_member(team_member_id))
  )
  with check (
    (select private.is_at_least('corporate_admin'))
    or ((select private.is_at_least('manager')) and private.can_manage_member(team_member_id))
  );

-- pay rates: managers+ can see rates for members they manage;
-- location_admin+ manages rates at their locations
create policy "team_member_pay_rates_select" on public.team_member_pay_rates
  for select to authenticated
  using (
    (select private.is_at_least('manager'))
    or team_member_id = private.current_team_member_id()
  );
create policy "team_member_pay_rates_insert" on public.team_member_pay_rates
  for insert to authenticated
  with check (
    (select private.is_at_least('corporate_admin'))
    or ((select private.is_at_least('location_admin')) and private.has_location_access(location_id))
  );
create policy "team_member_pay_rates_update" on public.team_member_pay_rates
  for update to authenticated
  using (
    (select private.is_at_least('corporate_admin'))
    or ((select private.is_at_least('location_admin')) and private.has_location_access(location_id))
  )
  with check (
    (select private.is_at_least('corporate_admin'))
    or ((select private.is_at_least('location_admin')) and private.has_location_access(location_id))
  );
-- no delete policy: retired rates are set to status = 'inactive', never hard-deleted

-- -----------------------------------------------------------------------------
-- Directory view: safe coworker fields for schedule rendering.
-- Owned by postgres (security_invoker off), so it bypasses team_members RLS;
-- it exposes only non-PII columns and is granted to authenticated only.
-- -----------------------------------------------------------------------------

create view public.team_member_directory
with (security_barrier)
as
select
  id,
  first_name,
  last_name,
  preferred_name,
  profile_photo,
  home_location_id,
  permission_level,
  status
from public.team_members
where status <> 'archived';

revoke all on public.team_member_directory from anon, authenticated;
grant select on public.team_member_directory to authenticated;

-- -----------------------------------------------------------------------------
-- Grants for the private helper schema (needed so RLS policies can call helpers)
-- -----------------------------------------------------------------------------

grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;
alter default privileges in schema private
  grant execute on functions to authenticated;
