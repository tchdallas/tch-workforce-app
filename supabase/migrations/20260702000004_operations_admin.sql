-- =============================================================================
-- Domain 4: Operations & admin
-- app settings, audit log (+ the everything-audit trigger), live roadmap notes,
-- and the settings-driven approval routing for trades/giveaways
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

create type public.setting_scope as enum ('company', 'location', 'user');

create type public.roadmap_note_type as enum (
  'general',
  'role',
  'team_member',
  'shift',
  'coverage',
  'rotation',
  'event'
);

create type public.roadmap_visibility as enum (
  'managers_and_above',
  'admins_only',
  'specific_role_managers',
  'team_member_facing'
);

-- -----------------------------------------------------------------------------
-- app_settings
-- value is jsonb (base44 stored strings) so structured settings like
-- shift_swap_approval -> {"mode": "none" | "all" | "roles", "role_ids": [...]}
-- don't need ad-hoc encoding. Location-scoped settings override company scope.
-- -----------------------------------------------------------------------------

create table public.app_settings (
  id             uuid primary key default gen_random_uuid(),
  key            text not null,
  value          jsonb not null,
  scope          public.setting_scope not null default 'company',
  location_id    uuid references public.locations (id),
  team_member_id uuid references public.team_members (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (
    (scope = 'company' and location_id is null and team_member_id is null)
    or (scope = 'location' and location_id is not null and team_member_id is null)
    or (scope = 'user' and team_member_id is not null and location_id is null)
  )
);

create unique index app_settings_company_key
  on public.app_settings (key) where scope = 'company';
create unique index app_settings_location_key
  on public.app_settings (key, location_id) where scope = 'location';
create unique index app_settings_user_key
  on public.app_settings (key, team_member_id) where scope = 'user';

-- -----------------------------------------------------------------------------
-- audit_logs (append-only: no update or delete policies, ever)
-- -----------------------------------------------------------------------------

create table public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.team_members (id),
  actor_name   text, -- snapshot at time of action (survives later renames)
  action       text not null,
  entity_type  text not null,
  entity_id    uuid,
  location_id  uuid references public.locations (id), -- derived from the audited row; scopes manager visibility
  before_value jsonb,
  after_value  jsonb,
  details      text,
  created_at   timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx on public.audit_logs (actor_id);
create index audit_logs_created_idx on public.audit_logs (created_at);
create index audit_logs_location_idx on public.audit_logs (location_id);

-- -----------------------------------------------------------------------------
-- live_roadmap_notes
-- -----------------------------------------------------------------------------

create table public.live_roadmap_notes (
  id             uuid primary key default gen_random_uuid(),
  location_id    uuid not null references public.locations (id),
  shift_id       uuid references public.shifts (id),
  team_member_id uuid references public.team_members (id),
  role_id        uuid references public.roles (id),
  note_type      public.roadmap_note_type not null default 'general',
  visibility     public.roadmap_visibility not null default 'managers_and_above',
  note           text not null,
  date           date,
  created_by     uuid references public.team_members (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index live_roadmap_notes_location_date_idx
  on public.live_roadmap_notes (location_id, date);

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

create or replace function private.member_has_role(r uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_member_roles
    where team_member_id = private.current_team_member_id()
      and role_id = r
  );
$$;

-- Does accepting a trade/giveaway of this shift need manager approval?
-- Reads the shift_swap_approval setting (location scope overrides company);
-- no setting at all = no approval required (Victor's default).
create or replace function private.swap_approval_required(shift uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s record;
  setting jsonb;
begin
  select role_id, location_id into s from public.shifts where id = shift;
  if not found then
    return true; -- unknown shift: fail safe
  end if;

  select value into setting
  from public.app_settings
  where key = 'shift_swap_approval'
    and scope = 'location'
    and location_id = s.location_id;

  if setting is null then
    select value into setting
    from public.app_settings
    where key = 'shift_swap_approval'
      and scope = 'company';
  end if;

  if setting is null then
    return false;
  end if;

  return case setting->>'mode'
    when 'all' then true
    when 'roles' then (setting->'role_ids') ? s.role_id::text
    else false
  end;
end;
$$;

-- -----------------------------------------------------------------------------
-- Approval routing for trades and giveaways (attaches to Domain 3 tables).
-- A member's direct acceptance is downgraded to pending_manager when the
-- shift_swap_approval setting requires it. Manager+ actions pass through.
-- -----------------------------------------------------------------------------

create or replace function private.route_giveaway_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.is_at_least('manager') then
    return new;
  end if;
  if old.status = 'open'
     and new.status = 'accepted'
     and new.accepting_team_member_id = private.current_team_member_id()
     and private.swap_approval_required(new.shift_id) then
    new.status := 'pending_manager';
  end if;
  return new;
end;
$$;

create trigger route_acceptance before update on public.shift_giveaway_requests
  for each row execute function private.route_giveaway_acceptance();

create or replace function private.route_trade_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.is_at_least('manager') then
    return new;
  end if;
  if old.status = 'pending_team_member'
     and new.status = 'approved'
     and new.target_team_member_id = private.current_team_member_id()
     and (
       private.swap_approval_required(new.original_shift_id)
       or private.swap_approval_required(new.requested_shift_id)
     ) then
    new.status := 'pending_manager';
  end if;
  return new;
end;
$$;

create trigger route_acceptance before update on public.shift_trade_requests
  for each row execute function private.route_trade_acceptance();

-- -----------------------------------------------------------------------------
-- Triggers (housekeeping)
-- -----------------------------------------------------------------------------

create trigger set_updated_at before update on public.app_settings
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.live_roadmap_notes
  for each row execute function private.set_updated_at();

create or replace function private.set_note_created_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_by := coalesce(new.created_by, private.current_team_member_id());
  return new;
end;
$$;

create trigger set_note_created_by before insert on public.live_roadmap_notes
  for each row execute function private.set_note_created_by();

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- -----------------------------------------------------------------------------

alter table public.app_settings enable row level security;
alter table public.audit_logs enable row level security;
alter table public.live_roadmap_notes enable row level security;

-- app settings: company/location config is readable by everyone signed in
-- (clients need it to drive behavior); user-scoped rows are private.
-- Writes: company = super_admin, location = location_admin+ there,
-- user = self or a manager of that member. Deleting a setting = reverting to
-- the default, so delete is allowed to the same writers (and audited).
create policy "app_settings_select" on public.app_settings
  for select to authenticated
  using (
    scope <> 'user'
    or team_member_id = private.current_team_member_id()
    or private.can_manage_member(team_member_id)
  );
create policy "app_settings_write" on public.app_settings
  for all to authenticated
  using (
    (scope = 'company' and (select private.is_at_least('super_admin')))
    or (
      scope = 'location'
      and (select private.is_at_least('location_admin'))
      and private.has_location_access(location_id)
    )
    or (
      scope = 'user'
      and (
        team_member_id = private.current_team_member_id()
        or private.can_manage_member(team_member_id)
      )
    )
  )
  with check (
    (scope = 'company' and (select private.is_at_least('super_admin')))
    or (
      scope = 'location'
      and (select private.is_at_least('location_admin'))
      and private.has_location_access(location_id)
    )
    or (
      scope = 'user'
      and (
        team_member_id = private.current_team_member_id()
        or private.can_manage_member(team_member_id)
      )
    )
  );

-- audit log: only super_admin sees all locations; manager+ sees shift-related
-- history at their assigned locations only (powers the shift audit trail
-- screen). App-written entries must name the writer as actor.
-- No update/delete — append-only.
create policy "audit_logs_select" on public.audit_logs
  for select to authenticated
  using (
    (select private.is_at_least('super_admin'))
    or (
      (select private.is_at_least('manager'))
      and location_id is not null
      and private.has_location_access(location_id)
      and entity_type in (
        'shifts',
        'callouts',
        'open_shift_claims',
        'shift_giveaway_requests',
        'shift_giveaway_targets',
        'shift_trade_requests'
      )
    )
  );
create policy "audit_logs_insert" on public.audit_logs
  for insert to authenticated
  with check (actor_id = private.current_team_member_id());

-- roadmap notes: visibility ladder within the note's location;
-- manager+ at the location writes
create policy "live_roadmap_notes_select" on public.live_roadmap_notes
  for select to authenticated
  using (
    private.has_location_access(location_id)
    and (
      visibility = 'team_member_facing'
      or (visibility = 'managers_and_above' and (select private.is_at_least('manager')))
      or (visibility = 'admins_only' and (select private.is_at_least('location_admin')))
      or (
        visibility = 'specific_role_managers'
        and (select private.is_at_least('manager'))
        and (
          role_id is null
          or private.member_has_role(role_id)
          or (select private.is_at_least('location_admin'))
        )
      )
    )
  );
create policy "live_roadmap_notes_write" on public.live_roadmap_notes
  for all to authenticated
  using (
    (select private.is_at_least('manager'))
    and private.has_location_access(location_id)
  )
  with check (
    (select private.is_at_least('manager'))
    and private.has_location_access(location_id)
  );

-- -----------------------------------------------------------------------------
-- The everything-audit trigger: every insert/update/delete on every business
-- table is recorded with before/after images, even hard deletes of draft
-- shifts and admin actions. Writes as definer, so it cannot be bypassed.
-- -----------------------------------------------------------------------------

create or replace function private.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_team_member_id();
  actor_nm text;
  rec jsonb := to_jsonb(coalesce(new, old));
  loc uuid;
begin
  if actor is not null then
    select trim(first_name || ' ' || last_name) into actor_nm
    from public.team_members where id = actor;
  end if;

  -- best-effort location for scoping manager visibility: the row's own
  -- location, else the location of the shift it points at
  loc := coalesce(
    (rec ->> 'location_id')::uuid,
    private.shift_location_id((rec ->> 'shift_id')::uuid),
    private.shift_location_id((rec ->> 'original_shift_id')::uuid)
  );

  insert into public.audit_logs
    (actor_id, actor_name, action, entity_type, entity_id, location_id, before_value, after_value)
  values (
    actor,
    actor_nm,
    lower(tg_op),
    tg_table_name,
    case when rec ? 'id' then (rec->>'id')::uuid else null end,
    loc,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return null;
end;
$$;

create trigger audit after insert or update or delete on public.locations
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.roles
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.role_locations
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.team_members
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.team_member_locations
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.team_member_roles
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.team_member_pay_rates
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.shifts
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.schedule_templates
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.schedule_template_shifts
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.availability
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.blackout_days
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.time_off_requests
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.shift_trade_requests
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.shift_giveaway_requests
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.shift_giveaway_targets
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.open_shift_claims
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.callouts
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.live_roadmap_notes
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.app_settings
  for each row execute function private.write_audit_log();
