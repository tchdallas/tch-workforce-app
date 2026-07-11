-- =============================================================================
-- Attendance points — foundation (Phase 1 of the attendance system)
--
-- Native replacement for the AppSheet attendance trackers, implementing the
-- 2026 Revised TCH Attendance Policy (1/28/2026). This migration lays the data
-- foundation only: the point catalog, the high-volume-day calendar, the
-- infraction ledger, discipline records, and the read/appeal functions the
-- dashboards use. The manager review UI and the auto-suggestion engine (which
-- reads time_entries + callouts) come in later phases.
--
-- Design principle — CLEAN CONTROLS: nothing counts against a team member
-- until a manager issues it. The entire policy is data, not code: point values
-- live in a catalog table and every tunable rule (caps, windows, discipline
-- thresholds, multiplier) lives in attendance_policy_settings — both editable
-- only by super_admin, so a future policy revision is a settings change, not a
-- deploy. Managers (manager+) issue points; only admins (location_admin+)
-- may excuse points or decide appeals — enforced in RLS below.
-- =============================================================================

create type public.attendance_infraction_status as enum (
  'suggested', -- auto-detected, waiting on a manager; does NOT count yet
  'issued',    -- confirmed by a manager; counts toward the member's balance
  'excused',   -- removed by an admin (verified excuse); does not count
  'dismissed'  -- thrown out (false positive / no infraction); does not count
);

create type public.attendance_appeal_status as enum (
  'none',       -- no appeal filed
  'pending',    -- member appealed within 3 days; awaiting admin decision
  'upheld',     -- admin kept the points
  'overturned'  -- admin removed the points (infraction gets set to 'excused')
);

create type public.attendance_discipline_type as enum (
  'documented_coaching',   -- 4 points
  'written_warning',       -- 6 points
  'final_written_warning', -- 8 points
  'termination_review'     -- 10 points
);

create type public.attendance_source as enum (
  'auto',   -- proposed by the detection engine from clock/callout data
  'manual'  -- entered by a manager
);

-- -----------------------------------------------------------------------------
-- Policy settings — every tunable rule in the written policy, in one row.
-- Super admins edit these from the app; attendance_summary() and
-- attendance_file_appeal() read them live, so a change takes effect
-- immediately without touching history (points already issued keep the
-- values they were issued with).
-- -----------------------------------------------------------------------------

create table public.attendance_policy_settings (
  id                          boolean primary key default true check (id), -- single-row table
  new_hire_period_days        integer not null default 90  check (new_hire_period_days >= 0),
  new_hire_point_cap          numeric(5, 2) not null default 5  check (new_hire_point_cap > 0),
  standard_point_cap          numeric(5, 2) not null default 10 check (standard_point_cap > 0),
  rolling_window_months       integer not null default 12 check (rolling_window_months > 0),
  appeal_window_days          integer not null default 3  check (appeal_window_days >= 0),
  high_volume_multiplier      numeric(3, 1) not null default 2.0 check (high_volume_multiplier >= 1),
  coaching_threshold          numeric(5, 2) not null default 4,  -- documented coaching
  written_warning_threshold   numeric(5, 2) not null default 6,
  final_warning_threshold     numeric(5, 2) not null default 8,
  termination_threshold       numeric(5, 2) not null default 10, -- termination review
  policy_document_path        text,  -- storage path to the signed policy PDF (dashboard quick link)
  updated_by                  uuid references public.team_members (id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (coaching_threshold <= written_warning_threshold
     and written_warning_threshold <= final_warning_threshold
     and final_warning_threshold <= termination_threshold)
);

-- the one row, seeded with the 2026 policy
insert into public.attendance_policy_settings (id) values (true);

-- -----------------------------------------------------------------------------
-- Point catalog — the policy's infraction list, editable without a code change.
-- -----------------------------------------------------------------------------

create table public.attendance_infraction_types (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,        -- stable key used by the detector
  label         text not null,               -- shown to managers and members
  category      text not null,               -- late | early_departure | callout | absence
  points        numeric(4, 2) not null check (points >= 0),
  description    text,
  display_order  integer not null default 0,
  status         public.record_status not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Seed with the 2026 policy values. Early departures are intentionally inverse:
-- the less of the shift worked, the higher the points.
insert into public.attendance_infraction_types (code, label, category, points, display_order) values
  ('late_0_2',          'Late (0–2 hrs)',                       'late',            0.5, 10),
  ('late_2_plus',       'Late (2+ hrs)',                        'late',            2.0, 20),
  ('early_dep_gt75',    'Early departure (>75% of shift worked)','early_departure',0.5, 30),
  ('early_dep_50_75',   'Early departure (50–75% worked)',      'early_departure', 1.5, 40),
  ('early_dep_lt50',    'Early departure (<50% worked)',        'early_departure', 3.0, 50),
  ('proper_callout',    'Proper call-out (text ≥2 hrs before)', 'callout',         1.0, 60),
  ('improper_callout',  'Improper call-out (<2 hrs before)',    'callout',         1.5, 70),
  ('late_callout',      'Late call-out (<2 hrs after start)',   'callout',         3.0, 80),
  ('no_call_no_show',   'No Call / No-Show (>2 hrs after start)','absence',         5.0, 90);

-- -----------------------------------------------------------------------------
-- High-volume days — points are DOUBLED for infractions on these dates.
-- A null location_id means the day applies company-wide. Admins/managers keep
-- this list current (holidays + the nearest weekend + posted special events).
-- -----------------------------------------------------------------------------

create table public.high_volume_days (
  id           uuid primary key default gen_random_uuid(),
  event_date   date not null,
  label        text not null,
  location_id  uuid references public.locations (id), -- null = all locations
  created_by   uuid references public.team_members (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (event_date, location_id)
);

create index high_volume_days_date_idx on public.high_volume_days (event_date);

-- Seed the fixed company-wide holidays from the policy through mid-2027.
-- The weekend-adjacent days and citywide/special events are added by managers.
insert into public.high_volume_days (event_date, label) values
  ('2026-09-07', 'Labor Day'),
  ('2026-10-12', 'Columbus Day'),
  ('2026-11-11', 'Veterans Day'),
  ('2026-11-26', 'Thanksgiving'),
  ('2026-11-27', 'Black Friday'),
  ('2026-12-24', 'Christmas Eve'),
  ('2026-12-25', 'Christmas Day'),
  ('2026-12-31', 'New Year''s Eve'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-01-18', 'MLK Jr. Day'),
  ('2027-02-15', 'Presidents Day'),
  ('2027-03-28', 'Easter'),
  ('2027-05-31', 'Memorial Day'),
  ('2027-06-19', 'Juneteenth'),
  ('2027-07-04', 'Independence Day');

-- -----------------------------------------------------------------------------
-- Infraction ledger — the heart of the system.
-- points is the authoritative final value (base_points, doubled on high-volume
-- days). base_points snapshots the catalog value at issue time so later config
-- edits never rewrite history.
-- -----------------------------------------------------------------------------

create table public.attendance_infractions (
  id                  uuid primary key default gen_random_uuid(),
  team_member_id      uuid not null references public.team_members (id),
  infraction_type_id  uuid not null references public.attendance_infraction_types (id),
  occurred_on         date not null,                 -- gaming day of the infraction
  location_id         uuid references public.locations (id), -- scopes audit + manager visibility
  shift_id            uuid references public.shifts (id),
  time_entry_id       uuid references public.time_entries (id), -- source signal, if any
  callout_id          uuid references public.callouts (id),     -- source signal, if any
  base_points         numeric(4, 2) not null check (base_points >= 0),
  high_volume         boolean not null default false,
  points              numeric(4, 2) not null check (points >= 0), -- final, authoritative
  status              public.attendance_infraction_status not null default 'issued',
  source              public.attendance_source not null default 'manual',
  note                text,
  issued_by           uuid references public.team_members (id),
  issued_at           timestamptz,
  reviewed_by         uuid references public.team_members (id),
  reviewed_at         timestamptz,
  excused_by          uuid references public.team_members (id),
  excused_at          timestamptz,
  excuse_reason       text,
  appeal_status       public.attendance_appeal_status not null default 'none',
  appeal_note         text,
  appeal_filed_at     timestamptz,
  appeal_reviewed_by  uuid references public.team_members (id),
  appeal_reviewed_at  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index attendance_infractions_member_idx on public.attendance_infractions (team_member_id, occurred_on);
create index attendance_infractions_status_idx on public.attendance_infractions (status);
create index attendance_infractions_location_idx on public.attendance_infractions (location_id);
create index attendance_infractions_review_idx on public.attendance_infractions (status) where status = 'suggested';

-- -----------------------------------------------------------------------------
-- Discipline records — the progressive ladder (coaching → termination review).
-- -----------------------------------------------------------------------------

create table public.attendance_discipline_actions (
  id                uuid primary key default gen_random_uuid(),
  team_member_id    uuid not null references public.team_members (id),
  location_id       uuid references public.locations (id),
  action_type       public.attendance_discipline_type not null,
  balance_at_action numeric(5, 2),        -- point total when the action was taken
  note              text,
  document_path     text,                 -- signed write-up in storage, if attached
  issued_by         uuid references public.team_members (id),
  issued_at         timestamptz not null default now(),
  acknowledged_at   timestamptz,          -- set when the member acknowledges
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index attendance_discipline_member_idx on public.attendance_discipline_actions (team_member_id, issued_at);

-- -----------------------------------------------------------------------------
-- Triggers: updated_at + full audit trail (audit auto-derives location_id).
-- -----------------------------------------------------------------------------

create trigger set_updated_at before update on public.attendance_policy_settings
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.attendance_infraction_types
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.high_volume_days
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.attendance_infractions
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.attendance_discipline_actions
  for each row execute function private.set_updated_at();

-- policy edits are audited too — changing the rulebook should leave a trail
create trigger audit after insert or update or delete on public.attendance_policy_settings
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.attendance_infraction_types
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.attendance_infractions
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.attendance_discipline_actions
  for each row execute function private.write_audit_log();

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- -----------------------------------------------------------------------------

alter table public.attendance_policy_settings enable row level security;
alter table public.attendance_infraction_types enable row level security;
alter table public.high_volume_days enable row level security;
alter table public.attendance_infractions enable row level security;
alter table public.attendance_discipline_actions enable row level security;

-- Policy settings: everyone reads (dashboards render caps/thresholds from it);
-- ONLY super_admin edits — this is the company rulebook. Update-only: the
-- single row is created by the migration and can never be deleted or added to.
create policy "attendance_policy_select" on public.attendance_policy_settings
  for select to authenticated using (true);
create policy "attendance_policy_update" on public.attendance_policy_settings
  for update to authenticated
  using ((select private.is_at_least('super_admin')))
  with check ((select private.is_at_least('super_admin')));

-- Point catalog: everyone reads (needed to render); super_admin edits —
-- point values are policy, same bar as the settings above.
create policy "attendance_types_select" on public.attendance_infraction_types
  for select to authenticated using (true);
create policy "attendance_types_write" on public.attendance_infraction_types
  for all to authenticated
  using ((select private.is_at_least('super_admin')))
  with check ((select private.is_at_least('super_admin')));

-- High-volume calendar: everyone reads. Managers add days at their own
-- locations; company-wide days (null location) require corporate_admin+.
create policy "high_volume_days_select" on public.high_volume_days
  for select to authenticated using (true);
create policy "high_volume_days_write" on public.high_volume_days
  for all to authenticated
  using (
    (select private.is_at_least('corporate_admin'))
    or ((select private.is_at_least('manager')) and location_id is not null and private.has_location_access(location_id))
  )
  with check (
    (select private.is_at_least('corporate_admin'))
    or ((select private.is_at_least('manager')) and location_id is not null and private.has_location_access(location_id))
  );

-- Infractions:
--   read  — managers see everything for members they manage; a member sees only
--           their own FINAL records (issued/excused), never raw suggestions.
--   issue — manager+ for members they manage; may create only suggested/issued.
--   update— manager+ for members they manage, BUT setting a row to 'excused'
--           requires location_admin+ (managers issue points; admins forgive them).
create policy "attendance_infractions_select" on public.attendance_infractions
  for select to authenticated
  using (
    private.can_manage_member(team_member_id)
    or (team_member_id = private.current_team_member_id() and status in ('issued', 'excused'))
  );
create policy "attendance_infractions_insert" on public.attendance_infractions
  for insert to authenticated
  with check (
    (select private.is_at_least('manager'))
    and private.can_manage_member(team_member_id)
    and status in ('suggested', 'issued')
  );
create policy "attendance_infractions_update" on public.attendance_infractions
  for update to authenticated
  using (
    (select private.is_at_least('manager')) and private.can_manage_member(team_member_id)
  )
  with check (
    (select private.is_at_least('manager'))
    and private.can_manage_member(team_member_id)
    and (status <> 'excused' or (select private.is_at_least('location_admin')))
  );
-- no delete policy: infractions are never hard-deleted (dismiss/excuse instead)

-- Discipline records: member reads own; manager+ reads and writes for their members.
create policy "attendance_discipline_select" on public.attendance_discipline_actions
  for select to authenticated
  using (private.can_view_member(team_member_id));
create policy "attendance_discipline_insert" on public.attendance_discipline_actions
  for insert to authenticated
  with check (
    (select private.is_at_least('manager')) and private.can_manage_member(team_member_id)
  );
create policy "attendance_discipline_update" on public.attendance_discipline_actions
  for update to authenticated
  using (
    (select private.is_at_least('manager')) and private.can_manage_member(team_member_id)
  )
  with check (
    (select private.is_at_least('manager')) and private.can_manage_member(team_member_id)
  );

-- -----------------------------------------------------------------------------
-- attendance_summary(member) — the one call the dashboards use.
--
-- Returns the member's current point balance, the discipline level that balance
-- maps to, the applicable cap (5 during the first 90 days, else 10), and the
-- next points scheduled to expire. Applies the rolling 12-month window for
-- tenured members and the since-hire window for new hires. Definer, so it works
-- for team-member accounts (who can't read the raw math over coworkers), but it
-- still checks the caller may view the member.
-- -----------------------------------------------------------------------------

create or replace function public.attendance_summary(p_member_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg            public.attendance_policy_settings%rowtype;
  v_start        date;
  v_is_new_hire  boolean;
  v_window_start date;
  v_cap          numeric;
  v_balance      numeric;
  v_count        integer;
  v_next_points  numeric;
  v_next_expires date;
  v_discipline   text;
begin
  if not private.can_view_member(p_member_id) then
    raise exception 'Not authorized to view this member''s attendance';
  end if;

  select * into cfg from public.attendance_policy_settings;

  select start_date into v_start from public.team_members where id = p_member_id;

  v_is_new_hire := v_start is not null
    and current_date < (v_start + cfg.new_hire_period_days);

  if v_is_new_hire then
    v_window_start := v_start;                     -- count everything since hire
    v_cap := cfg.new_hire_point_cap;
  else
    v_window_start := (current_date - make_interval(months => cfg.rolling_window_months))::date;
    v_cap := cfg.standard_point_cap;
  end if;

  select coalesce(sum(points), 0), count(*)
    into v_balance, v_count
  from public.attendance_infractions
  where team_member_id = p_member_id
    and status = 'issued'
    and occurred_on >= v_window_start;

  -- the oldest still-counting infraction is the next to roll off
  select points, (occurred_on + make_interval(months => cfg.rolling_window_months))::date
    into v_next_points, v_next_expires
  from public.attendance_infractions
  where team_member_id = p_member_id
    and status = 'issued'
    and occurred_on >= v_window_start
  order by occurred_on asc
  limit 1;

  v_discipline := case
    when v_balance >= cfg.termination_threshold   then 'termination_review'
    when v_balance >= cfg.final_warning_threshold then 'final_written_warning'
    when v_balance >= cfg.written_warning_threshold then 'written_warning'
    when v_balance >= cfg.coaching_threshold      then 'documented_coaching'
    else 'none'
  end;

  return jsonb_build_object(
    'member_id',        p_member_id,
    'is_new_hire',      coalesce(v_is_new_hire, false),
    'point_cap',        v_cap,
    'balance',          v_balance,
    'infraction_count', v_count,
    'discipline_level', v_discipline,
    'window_start',     v_window_start,
    'next_to_expire',   case when v_next_points is null then null
                        else jsonb_build_object('points', v_next_points, 'expires_on', v_next_expires) end
  );
end;
$$;

grant execute on function public.attendance_summary(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- attendance_file_appeal(infraction, note) — a member appeals their own issued
-- infraction within the 3-day window. Only flips it to 'pending'; an admin
-- decides the outcome. Definer so the member can update a row they otherwise
-- can't write.
-- -----------------------------------------------------------------------------

create or replace function public.attendance_file_appeal(p_infraction_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member   uuid;
  v_occurred date;
  v_status   public.attendance_infraction_status;
  v_appeal   public.attendance_appeal_status;
  v_window   integer;
begin
  select appeal_window_days into v_window from public.attendance_policy_settings;

  select team_member_id, occurred_on, status, appeal_status
    into v_member, v_occurred, v_status, v_appeal
  from public.attendance_infractions
  where id = p_infraction_id;

  if v_member is null then
    raise exception 'Infraction not found';
  end if;
  if v_member <> private.current_team_member_id() then
    raise exception 'You can only appeal your own infractions';
  end if;
  if v_status <> 'issued' then
    raise exception 'Only issued infractions can be appealed';
  end if;
  if current_date > (v_occurred + v_window) then
    raise exception 'The %-day appeal window has passed', v_window;
  end if;
  if v_appeal <> 'none' then
    raise exception 'An appeal already exists for this infraction';
  end if;

  update public.attendance_infractions
    set appeal_status   = 'pending',
        appeal_note     = p_note,
        appeal_filed_at = now()
  where id = p_infraction_id;
end;
$$;

grant execute on function public.attendance_file_appeal(uuid, text) to authenticated;
