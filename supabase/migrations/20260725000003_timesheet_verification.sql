-- =============================================================================
-- Timesheet verification
--
-- Payroll is the one place an unreviewed mistake costs real money, so a time
-- entry now has to be agreed before it can be exported.
--
-- One rule produces every case: WHENEVER A MANAGER ASSERTS A TIME THE CLOCK DID
-- NOT RECORD, THE TEAM MEMBER HAS TO CONSENT TO IT.
--
--   open            clocked in, not out yet — nothing to review
--   pending_manager complete; waiting on a manager
--   pending_member  a manager asserted a time; waiting on the member
--   verified        agreed. ONLY THESE EXPORT.
--
-- Scenarios:
--   1. clean punch          -> pending_manager -> manager approves -> verified
--   2. forgot clock-out     -> manager proposes an out time -> pending_member
--   3. forgot clock-in      -> manager creates the entry     -> pending_member
--   4. forgot both          -> manager creates the entry     -> pending_member
-- In 2-4 the member may accept, or counter with their real time, which bounces
-- back to the manager. A clean punch never bothers the member at all.
--
-- Missed punches are also recorded as punch_exceptions, which is what the
-- reliability score on someone's profile is computed from.
-- =============================================================================

create type public.time_entry_status as enum (
  'open', 'pending_manager', 'pending_member', 'verified'
);

alter table public.time_entries
  add column status public.time_entry_status not null default 'open',
  -- who signed off, on each side
  add column approved_by          uuid references public.team_members (id),
  add column approved_at          timestamptz,
  add column member_confirmed_at  timestamptz,
  -- the times currently being proposed, and by whom. Kept separate from the
  -- real clock_in/clock_out so a proposal never silently becomes payroll data —
  -- it's copied across only when the other side accepts.
  add column proposed_clock_in    timestamptz,
  add column proposed_clock_out   timestamptz,
  add column proposed_by          uuid references public.team_members (id),
  add column proposed_at          timestamptz,
  add column proposal_note        text,
  -- scenarios 3 and 4: no punch happened at all, a manager entered the shift
  add column manager_created      boolean not null default false,
  -- export bookkeeping, so a period can't be silently sent twice
  add column exported_at          timestamptz,
  add column exported_by          uuid references public.team_members (id);

create index time_entries_status_idx on public.time_entries (status);
create index time_entries_pending_member_idx
  on public.time_entries (team_member_id) where status = 'pending_member';

-- Grandfather everything that already exists. These predate verification and
-- have in most cases already been paid; dropping ~weeks of history into a
-- manager's queue on day one would train everyone to bulk-approve without
-- looking, which is precisely the habit this feature exists to prevent.
-- (the casts are load-bearing: CASE resolves to text, which an enum column
-- won't take implicitly)
update public.time_entries
set status = case when clock_out is null
                  then 'open'::public.time_entry_status
                  else 'verified'::public.time_entry_status end,
    approved_at = case when clock_out is null then null else now() end;

-- -----------------------------------------------------------------------------
-- Missed-punch log — the raw material for the reliability score
-- -----------------------------------------------------------------------------

create type public.punch_exception_kind as enum ('missed_in', 'missed_out', 'missed_both');

create table public.punch_exceptions (
  id             uuid primary key default gen_random_uuid(),
  team_member_id uuid not null references public.team_members (id) on delete cascade,
  time_entry_id  uuid references public.time_entries (id) on delete cascade,
  shift_id       uuid references public.shifts (id) on delete set null,
  location_id    uuid references public.locations (id),
  kind           public.punch_exception_kind not null,
  occurred_on    date not null,
  note           text,
  created_at     timestamptz not null default now()
);

create index punch_exceptions_member_idx on public.punch_exceptions (team_member_id, occurred_on desc);
-- one exception per entry per kind, so a manager re-proposing a time doesn't
-- keep stacking marks against the same forgotten punch
create unique index punch_exceptions_entry_kind_key
  on public.punch_exceptions (time_entry_id, kind) where time_entry_id is not null;

-- -----------------------------------------------------------------------------
-- Status upkeep
-- -----------------------------------------------------------------------------

-- A clock-out arriving from anywhere (kiosk, mobile, callout, auto-close) moves
-- the entry into a manager's queue. Written as a trigger rather than folded into
-- punch_clock so every path is covered, including the cron.
create or replace function private.time_entry_status_upkeep()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'open' and new.clock_out is not null then
      new.status := 'pending_manager';
    end if;
    return new;
  end if;

  -- reopening a corrected entry sends it back for review
  if new.clock_out is null and old.clock_out is not null then
    new.status := 'open';
  elsif old.clock_out is null and new.clock_out is not null and new.status = 'open' then
    new.status := 'pending_manager';
  end if;
  return new;
end;
$$;

create trigger time_entry_status_upkeep
  before insert or update on public.time_entries
  for each row execute function private.time_entry_status_upkeep();

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

create or replace function private.can_manage_time_entry(eid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select private.is_at_least('manager'))
     and exists (
       select 1 from public.time_entries te
       where te.id = eid
         and (
           (te.location_id is not null and private.has_location_access(te.location_id))
           or private.shares_location_with(te.team_member_id)
         )
     );
$$;

create or replace function private.owns_time_entry(eid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.time_entries te
    where te.id = eid and te.team_member_id = private.current_team_member_id()
  );
$$;

-- Record that a punch was missed, if we haven't already for this entry+kind.
create or replace function private.log_punch_exception(
  p_entry uuid, p_kind public.punch_exception_kind, p_note text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  e public.time_entries;
begin
  select * into e from public.time_entries where id = p_entry;
  if not found then return; end if;
  insert into public.punch_exceptions
    (team_member_id, time_entry_id, shift_id, location_id, kind, occurred_on, note)
  values
    (e.team_member_id, e.id, e.shift_id, e.location_id, p_kind,
     (e.clock_in at time zone 'America/Chicago')::date, p_note)
  on conflict (time_entry_id, kind) where time_entry_id is not null do nothing;
end;
$$;

-- -----------------------------------------------------------------------------
-- Manager actions
-- -----------------------------------------------------------------------------

-- Scenario 1: the punches stand as recorded. Nothing asserted, so the member is
-- never asked — this is the common path and it must stay a single tap.
create or replace function public.timesheet_approve(eid uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  e public.time_entries;
begin
  select * into e from public.time_entries where id = eid;
  if not found then raise exception 'time entry not found'; end if;
  if not private.can_manage_time_entry(eid) then
    raise exception 'not allowed to approve this entry';
  end if;
  if e.clock_out is null then
    raise exception 'this entry has no clock-out yet';
  end if;
  if e.status = 'pending_member' then
    raise exception 'this entry is waiting on the team member';
  end if;

  update public.time_entries
  set status = 'verified',
      approved_by = private.current_team_member_id(),
      approved_at = now(),
      proposed_clock_in = null, proposed_clock_out = null,
      proposed_by = null, proposed_at = null, proposal_note = null
  where id = eid;
end;
$$;

grant execute on function public.timesheet_approve(uuid) to authenticated;

-- Scenarios 2-4 and any correction: the manager asserts times, which the member
-- must consent to. The proposal is staged, not applied.
create or replace function public.timesheet_propose(
  eid uuid, p_in timestamptz, p_out timestamptz, p_note text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  e public.time_entries;
begin
  select * into e from public.time_entries where id = eid;
  if not found then raise exception 'time entry not found'; end if;
  if not private.can_manage_time_entry(eid) then
    raise exception 'not allowed to edit this entry';
  end if;
  if p_in is null then raise exception 'a start time is required'; end if;
  if p_out is not null and p_out <= p_in then
    raise exception 'the end time must be after the start time';
  end if;

  update public.time_entries
  set proposed_clock_in = p_in,
      proposed_clock_out = p_out,
      proposed_by = private.current_team_member_id(),
      proposed_at = now(),
      proposal_note = nullif(trim(coalesce(p_note, '')), ''),
      status = 'pending_member'
  where id = eid;

  -- a time the clock never recorded is, by definition, a missed punch
  if e.clock_in is distinct from p_in and e.clock_out is distinct from p_out then
    perform private.log_punch_exception(eid, 'missed_both', p_note);
  elsif e.clock_out is null or e.clock_out is distinct from p_out then
    perform private.log_punch_exception(eid, 'missed_out', p_note);
  elsif e.clock_in is distinct from p_in then
    perform private.log_punch_exception(eid, 'missed_in', p_note);
  end if;

  perform private.notify(
    e.team_member_id, 'timesheet',
    'Check your hours',
    'A manager suggested times for your '
      || to_char(e.clock_in at time zone 'America/Chicago', 'Mon FMDD')
      || ' shift. Approve them or enter your actual times.',
    'TimeEntry', eid
  );
end;
$$;

grant execute on function public.timesheet_propose(uuid, timestamptz, timestamptz, text) to authenticated;

-- Scenarios 3 and 4: nothing was punched at all, so there's no row to correct.
create or replace function public.timesheet_create_missing(
  p_member uuid, p_location uuid, p_shift uuid,
  p_in timestamptz, p_out timestamptz, p_note text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  new_id uuid;
begin
  if not (select private.is_at_least('manager')) then
    raise exception 'only managers and above may add a missing entry';
  end if;
  if not (private.has_location_access(p_location) or private.shares_location_with(p_member)) then
    raise exception 'not allowed to add an entry for this person';
  end if;
  if p_in is null then raise exception 'a start time is required'; end if;
  if p_out is not null and p_out <= p_in then
    raise exception 'the end time must be after the start time';
  end if;

  insert into public.time_entries
    (team_member_id, location_id, shift_id, clock_in, clock_out, method,
     manager_created, edited_by, edit_note,
     proposed_clock_in, proposed_clock_out, proposed_by, proposed_at, proposal_note,
     status)
  values
    (p_member, p_location, p_shift, p_in, p_out, 'manual',
     true, private.current_team_member_id(),
     'Added by a manager — no punch was recorded',
     p_in, p_out, private.current_team_member_id(), now(), p_note,
     'pending_member')
  returning id into new_id;

  perform private.log_punch_exception(
    new_id,
    case when p_out is null
         then 'missed_in'::public.punch_exception_kind
         else 'missed_both'::public.punch_exception_kind end,
    coalesce(p_note, 'No punch recorded')
  );

  perform private.notify(
    p_member, 'timesheet',
    'Confirm a shift you didn''t clock in for',
    'A manager added your '
      || to_char(p_in at time zone 'America/Chicago', 'Mon FMDD')
      || ' shift. Approve the times or enter your actual ones.',
    'TimeEntry', new_id
  );
  return new_id;
end;
$$;

grant execute on function public.timesheet_create_missing(uuid, uuid, uuid, timestamptz, timestamptz, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Team-member actions
-- -----------------------------------------------------------------------------

-- Accept what the manager proposed: the staged times become the real ones.
create or replace function public.timesheet_member_accept(eid uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  e public.time_entries;
begin
  select * into e from public.time_entries where id = eid;
  if not found then raise exception 'time entry not found'; end if;
  if e.team_member_id <> private.current_team_member_id() then
    raise exception 'this is not your time entry';
  end if;
  if e.status <> 'pending_member' then
    raise exception 'there is nothing to approve on this entry';
  end if;

  update public.time_entries
  set clock_in  = coalesce(proposed_clock_in, clock_in),
      clock_out = coalesce(proposed_clock_out, clock_out),
      member_confirmed_at = now(),
      status = 'verified',
      approved_by = coalesce(approved_by, proposed_by),
      approved_at = coalesce(approved_at, proposed_at),
      auto_closed = false,
      proposed_clock_in = null, proposed_clock_out = null,
      proposed_by = null, proposed_at = null, proposal_note = null
  where id = eid;
end;
$$;

grant execute on function public.timesheet_member_accept(uuid) to authenticated;

-- Or counter with what actually happened. Back to the manager — the member
-- can't unilaterally set their own paid hours.
create or replace function public.timesheet_member_counter(
  eid uuid, p_in timestamptz, p_out timestamptz, p_note text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  e public.time_entries;
  r record;
  who text;
begin
  select * into e from public.time_entries where id = eid;
  if not found then raise exception 'time entry not found'; end if;
  if e.team_member_id <> private.current_team_member_id() then
    raise exception 'this is not your time entry';
  end if;
  if e.status <> 'pending_member' then
    raise exception 'there is nothing to respond to on this entry';
  end if;
  if p_in is null then raise exception 'a start time is required'; end if;
  if p_out is not null and p_out <= p_in then
    raise exception 'the end time must be after the start time';
  end if;

  update public.time_entries
  set proposed_clock_in = p_in,
      proposed_clock_out = p_out,
      proposed_by = private.current_team_member_id(),
      proposed_at = now(),
      proposal_note = nullif(trim(coalesce(p_note, '')), ''),
      status = 'pending_manager'
  where id = eid;

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
      'Timesheet correction from ' || who,
      who || ' proposed different times for their '
        || to_char(e.clock_in at time zone 'America/Chicago', 'Mon FMDD')
        || ' shift. Review it in Timesheets.',
      'TimeEntry', eid
    );
  end loop;
end;
$$;

grant execute on function public.timesheet_member_counter(uuid, timestamptz, timestamptz, text) to authenticated;

-- A manager accepting the member's counter-proposal closes the loop. Both sides
-- have now asserted the same times, so no further consent is needed.
create or replace function public.timesheet_accept_counter(eid uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  e public.time_entries;
begin
  select * into e from public.time_entries where id = eid;
  if not found then raise exception 'time entry not found'; end if;
  if not private.can_manage_time_entry(eid) then
    raise exception 'not allowed to approve this entry';
  end if;
  if e.status <> 'pending_manager' or e.proposed_at is null then
    raise exception 'there is no correction to accept on this entry';
  end if;

  update public.time_entries
  set clock_in  = coalesce(proposed_clock_in, clock_in),
      clock_out = coalesce(proposed_clock_out, clock_out),
      member_confirmed_at = coalesce(member_confirmed_at, proposed_at),
      status = 'verified',
      approved_by = private.current_team_member_id(),
      approved_at = now(),
      auto_closed = false,
      proposed_clock_in = null, proposed_clock_out = null,
      proposed_by = null, proposed_at = null, proposal_note = null
  where id = eid;
end;
$$;

grant execute on function public.timesheet_accept_counter(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Reminders
-- -----------------------------------------------------------------------------

-- Nudge the person, not just their manager. The existing cron told managers
-- about a missing clock-out but never told the member, who is the only one who
-- can actually fix it in the moment.
create or replace function private.remind_missing_punches()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  e record;
  s record;
begin
  -- still on the clock well past the end of the shift
  for e in
    select te.id, te.team_member_id, te.clock_in
    from public.time_entries te
    join public.shifts s on s.id = te.shift_id
    where te.clock_out is null
      and now() > s.end_at + interval '20 minutes'
      and now() < s.end_at + interval '4 hours' -- after this the auto-close takes over
  loop
    perform private.notify(
      e.team_member_id, 'timesheet',
      'Did you forget to clock out?',
      'You''re still on the clock. Punch out at the kiosk, or tell your manager so they can correct it.',
      'TimeEntry', e.id
    );
  end loop;

  -- scheduled, well underway, and never punched in
  for s in
    select sh.id, sh.team_member_id, sh.start_at
    from public.shifts sh
    where sh.team_member_id is not null
      and sh.status = 'published'
      and coalesce(sh.archived, false) = false
      and now() > sh.start_at + interval '20 minutes'
      and now() < sh.start_at + interval '3 hours'
      and not exists (
        select 1 from public.time_entries te
        where te.team_member_id = sh.team_member_id
          and te.clock_in between sh.start_at - interval '2 hours' and sh.end_at
      )
  loop
    perform private.notify(
      s.team_member_id, 'timesheet',
      'Did you forget to clock in?',
      'Your shift started at '
        || to_char(s.start_at at time zone 'America/Chicago', 'FMHH12:MI AM')
        || ' and there''s no punch. Clock in at the kiosk, or tell your manager.',
      'Shift', s.id
    );
  end loop;
end;
$$;

-- every 15 min: often enough to catch it the same shift, rare enough not to nag
select cron.schedule('remind-missing-punches', '*/15 * * * *',
  'select private.remind_missing_punches()');

-- The manual nudge: a manager pushing a reminder at someone right now.
create or replace function public.timesheet_force_reminder(eid uuid, p_message text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  e public.time_entries;
begin
  select * into e from public.time_entries where id = eid;
  if not found then raise exception 'time entry not found'; end if;
  if not private.can_manage_time_entry(eid) then
    raise exception 'not allowed to send a reminder for this entry';
  end if;

  perform private.notify(
    e.team_member_id, 'timesheet',
    'Your timesheet needs you',
    coalesce(nullif(trim(p_message), ''),
      'Please review and confirm your hours so payroll can go out on time.'),
    'TimeEntry', eid
  );
end;
$$;

grant execute on function public.timesheet_force_reminder(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Reliability score
--
-- Share of a person's shifts where the clock captured both punches without a
-- manager having to step in. Informational, plus a threshold flag for managers.
-- -----------------------------------------------------------------------------

create or replace function public.punch_reliability(p_member uuid, p_days integer default 90)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_shifts integer;
  v_misses integer;
begin
  if p_member <> private.current_team_member_id()
     and not (select private.is_at_least('manager')) then
    raise exception 'not allowed to read this score';
  end if;
  if p_member <> private.current_team_member_id()
     and not private.shares_location_with(p_member)
     and not (select private.is_at_least('corporate_admin')) then
    raise exception 'not allowed to read this score';
  end if;

  -- denominator: shifts they actually worked, not shifts scheduled, so time off
  -- and unfilled shifts never count against anyone
  select count(*) into v_shifts
  from public.time_entries te
  where te.team_member_id = p_member
    and te.clock_in > now() - make_interval(days => p_days);

  select count(*) into v_misses
  from public.punch_exceptions pe
  where pe.team_member_id = p_member
    and pe.occurred_on > (now() - make_interval(days => p_days))::date;

  return jsonb_build_object(
    'days', p_days,
    'shifts', v_shifts,
    'misses', v_misses,
    -- no shifts yet reads as perfect rather than 0%, so new hires aren't flagged
    'score', case when v_shifts = 0 then 100
                  else greatest(0, round(100.0 * (v_shifts - v_misses) / v_shifts))::int end
  );
end;
$$;

grant execute on function public.punch_reliability(uuid, integer) to authenticated;

-- Everyone at my locations who is below the threshold, for the manager view.
create or replace function public.punch_reliability_flags(p_days integer default 90, p_threshold integer default 90)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when not (select private.is_at_least('manager')) then '[]'::jsonb
  else coalesce(jsonb_agg(x order by x->>'score'), '[]'::jsonb) end
  from (
    select jsonb_build_object(
      'team_member_id', tm.id,
      'name', coalesce(nullif(tm.preferred_name, ''), tm.first_name) || ' ' || tm.last_name,
      'shifts', cnt.shifts,
      'misses', cnt.misses,
      'score', round(100.0 * (cnt.shifts - cnt.misses) / cnt.shifts)::int
    ) as x
    from public.team_members tm
    join lateral (
      select
        (select count(*) from public.time_entries te
          where te.team_member_id = tm.id
            and te.clock_in > now() - make_interval(days => p_days)) as shifts,
        (select count(*) from public.punch_exceptions pe
          where pe.team_member_id = tm.id
            and pe.occurred_on > (now() - make_interval(days => p_days))::date) as misses
    ) cnt on true
    where tm.status = 'active'
      and cnt.shifts >= 5 -- too few shifts to say anything meaningful
      and round(100.0 * (cnt.shifts - cnt.misses) / cnt.shifts)::int < p_threshold
      and (private.is_at_least('corporate_admin') or private.shares_location_with(tm.id))
  ) s;
$$;

grant execute on function public.punch_reliability_flags(integer, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- Export
-- -----------------------------------------------------------------------------

-- Stamp what actually went out, so a second export is visibly a re-export.
create or replace function public.timesheet_mark_exported(p_ids uuid[])
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  if not (select private.is_at_least('manager')) then
    raise exception 'only managers and above may export timesheets';
  end if;
  update public.time_entries te
  set exported_at = now(), exported_by = private.current_team_member_id()
  where te.id = any(p_ids)
    and te.status = 'verified'
    and private.can_manage_time_entry(te.id);
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.timesheet_mark_exported(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- -----------------------------------------------------------------------------

-- Verification is only real if it can't be walked around. RLS grants managers
-- UPDATE on time_entries, which would let a client PATCH clock_in/clock_out
-- straight past the approval flow. Revoke those columns specifically: the
-- security-definer functions above still write them (they run as the owner),
-- and so do punch_clock and the crons, but nothing else can.
revoke update (clock_in, clock_out, status, approved_by, approved_at,
               member_confirmed_at, exported_at, exported_by)
  on public.time_entries from authenticated;

alter table public.punch_exceptions enable row level security;

-- you see your own record; managers see it for people at their locations.
-- Written only by the definer functions above.
create policy "punch_exceptions_select" on public.punch_exceptions
  for select to authenticated
  using (
    team_member_id = private.current_team_member_id()
    or (
      (select private.is_at_least('manager'))
      and (
        (select private.is_at_least('corporate_admin'))
        or private.shares_location_with(team_member_id)
      )
    )
  );

create trigger audit after insert or update or delete on public.punch_exceptions
  for each row execute function private.write_audit_log();
