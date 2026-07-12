-- =============================================================================
-- Attendance points — issuance & review (Phase 2)
--
-- The action layer on top of the foundation migration:
--   issue_attendance_infraction  — manager+ issues points; snapshots the
--                                  catalog value and applies high-volume
--                                  doubling from policy settings
--   review_attendance_infraction — manager+ confirms/dismisses auto-suggested
--                                  rows; location_admin+ excuses issued ones
--   decide_attendance_appeal     — location_admin+ upholds or overturns a
--                                  member's appeal
--   attendance_balances          — the manager roster: every active member at
--                                  a location with balance, cap, discipline
-- Plus notification triggers so members hear about points the moment they land.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- issue_attendance_infraction
-- -----------------------------------------------------------------------------

create or replace function public.issue_attendance_infraction(
  p_member_id  uuid,
  p_type_id    uuid,
  p_occurred_on date,
  p_shift_id   uuid default null,
  p_note       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      public.attendance_policy_settings%rowtype;
  t        public.attendance_infraction_types%rowtype;
  v_loc    uuid;
  v_high   boolean;
  v_points numeric(4, 2);
  v_id     uuid;
begin
  if not ((select private.is_at_least('manager')) and private.can_manage_member(p_member_id)) then
    raise exception 'Only managers can issue attendance points, and only for members at their locations';
  end if;
  if p_occurred_on > current_date then
    raise exception 'Cannot issue an infraction for a future date';
  end if;

  select * into cfg from public.attendance_policy_settings;

  select * into t
  from public.attendance_infraction_types
  where id = p_type_id and status = 'active';
  if t.id is null then
    raise exception 'Unknown or archived infraction type';
  end if;

  -- location scopes audit + manager visibility: the shift's, else home location
  v_loc := coalesce(
    (select s.location_id from public.shifts s where s.id = p_shift_id),
    (select tm.home_location_id from public.team_members tm where tm.id = p_member_id)
  );

  v_high := exists (
    select 1 from public.high_volume_days d
    where d.event_date = p_occurred_on
      and (d.location_id is null or d.location_id = v_loc)
  );

  -- snapshot the catalog value; double on high-volume days ("cannot be doubled twice")
  v_points := case when v_high then round(t.points * cfg.high_volume_multiplier, 2)
                   else t.points end;

  insert into public.attendance_infractions
    (team_member_id, infraction_type_id, occurred_on, location_id, shift_id,
     base_points, high_volume, points, status, source, note, issued_by, issued_at)
  values
    (p_member_id, p_type_id, p_occurred_on, v_loc, p_shift_id,
     t.points, v_high, v_points, 'issued', 'manual', p_note,
     private.current_team_member_id(), now())
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'points', v_points, 'high_volume', v_high);
end;
$$;

grant execute on function public.issue_attendance_infraction(uuid, uuid, date, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- review_attendance_infraction — confirm/dismiss suggestions (manager+),
-- excuse issued points (location_admin+ only; managers issue, admins forgive).
-- -----------------------------------------------------------------------------

create or replace function public.review_attendance_infraction(
  p_id     uuid,
  p_action text,               -- 'confirm' | 'dismiss' | 'excuse'
  p_note   text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.attendance_infractions%rowtype;
  actor uuid := private.current_team_member_id();
begin
  select * into r from public.attendance_infractions where id = p_id;
  if r.id is null then
    raise exception 'Infraction not found';
  end if;
  if not ((select private.is_at_least('manager')) and private.can_manage_member(r.team_member_id)) then
    raise exception 'Not authorized to review this infraction';
  end if;

  if p_action = 'confirm' then
    if r.status <> 'suggested' then
      raise exception 'Only suggested infractions can be confirmed';
    end if;
    update public.attendance_infractions
      set status = 'issued', issued_by = actor, issued_at = now(),
          reviewed_by = actor, reviewed_at = now(),
          note = coalesce(p_note, note)
    where id = p_id;

  elsif p_action = 'dismiss' then
    if r.status <> 'suggested' then
      raise exception 'Only suggested infractions can be dismissed — issued points must be excused by an admin';
    end if;
    update public.attendance_infractions
      set status = 'dismissed', reviewed_by = actor, reviewed_at = now(),
          note = coalesce(p_note, note)
    where id = p_id;

  elsif p_action = 'excuse' then
    if not (select private.is_at_least('location_admin')) then
      raise exception 'Only admins can excuse attendance points';
    end if;
    if r.status not in ('suggested', 'issued') then
      raise exception 'This infraction is already %', r.status;
    end if;
    if p_note is null or trim(p_note) = '' then
      raise exception 'An excuse reason is required';
    end if;
    update public.attendance_infractions
      set status = 'excused', excused_by = actor, excused_at = now(),
          excuse_reason = p_note
    where id = p_id;

  else
    raise exception 'Unknown action: %', p_action;
  end if;
end;
$$;

grant execute on function public.review_attendance_infraction(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- decide_attendance_appeal — location_admin+ resolves a pending appeal.
-- Overturning excuses the infraction (points come off immediately).
-- -----------------------------------------------------------------------------

create or replace function public.decide_attendance_appeal(
  p_id       uuid,
  p_decision text,             -- 'upheld' | 'overturned'
  p_note     text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.attendance_infractions%rowtype;
  actor uuid := private.current_team_member_id();
begin
  select * into r from public.attendance_infractions where id = p_id;
  if r.id is null then
    raise exception 'Infraction not found';
  end if;
  if not ((select private.is_at_least('location_admin')) and private.can_manage_member(r.team_member_id)) then
    raise exception 'Only admins can decide appeals';
  end if;
  if r.appeal_status <> 'pending' then
    raise exception 'No pending appeal on this infraction';
  end if;
  if p_decision not in ('upheld', 'overturned') then
    raise exception 'Decision must be upheld or overturned';
  end if;

  update public.attendance_infractions
    set appeal_status      = p_decision::public.attendance_appeal_status,
        appeal_reviewed_by = actor,
        appeal_reviewed_at = now(),
        status        = case when p_decision = 'overturned' then 'excused'::public.attendance_infraction_status else status end,
        excused_by    = case when p_decision = 'overturned' then actor else excused_by end,
        excused_at    = case when p_decision = 'overturned' then now() else excused_at end,
        excuse_reason = case when p_decision = 'overturned' then coalesce(p_note, 'Appeal overturned') else excuse_reason end
  where id = p_id;
end;
$$;

grant execute on function public.decide_attendance_appeal(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- attendance_balances — the manager roster for one location. Active members
-- (home or assigned there) with their live balance under the policy windows.
-- Definer so it can sum over rows the caller may not read directly, but it
-- refuses callers below manager or without access to the location.
-- -----------------------------------------------------------------------------

create or replace function public.attendance_balances(p_location_id uuid)
returns table (
  team_member_id     uuid,
  display_name       text,
  is_new_hire        boolean,
  point_cap          numeric,
  balance            numeric,
  infraction_count   integer,
  discipline_level   text,
  last_infraction_on date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not ((select private.is_at_least('manager')) and private.has_location_access(p_location_id)) then
    raise exception 'Not authorized to view attendance for this location';
  end if;

  return query
  select tm.id,
         (coalesce(tm.preferred_name, tm.first_name) || ' ' || tm.last_name)::text,
         (tm.start_date is not null and current_date < tm.start_date + cfg.new_hire_period_days),
         case when tm.start_date is not null and current_date < tm.start_date + cfg.new_hire_period_days
              then cfg.new_hire_point_cap else cfg.standard_point_cap end,
         coalesce(inf.balance, 0),
         coalesce(inf.cnt, 0),
         (case
            when coalesce(inf.balance, 0) >= cfg.termination_threshold     then 'termination_review'
            when coalesce(inf.balance, 0) >= cfg.final_warning_threshold   then 'final_written_warning'
            when coalesce(inf.balance, 0) >= cfg.written_warning_threshold then 'written_warning'
            when coalesce(inf.balance, 0) >= cfg.coaching_threshold        then 'documented_coaching'
            else 'none'
          end)::text,
         inf.last_on
  from public.team_members tm
  cross join public.attendance_policy_settings cfg
  left join lateral (
    select sum(i.points) as balance, count(*)::integer as cnt, max(i.occurred_on) as last_on
    from public.attendance_infractions i
    where i.team_member_id = tm.id
      and i.status = 'issued'
      and i.occurred_on >= case
        when tm.start_date is not null and current_date < tm.start_date + cfg.new_hire_period_days
          then tm.start_date
        else (current_date - make_interval(months => cfg.rolling_window_months))::date
      end
  ) inf on true
  where tm.status = 'active'
    and (tm.home_location_id = p_location_id
         or exists (select 1 from public.team_member_locations l
                    where l.team_member_id = tm.id and l.location_id = p_location_id))
  order by 2;
end;
$$;

grant execute on function public.attendance_balances(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Notifications — the member hears about every consequential change:
-- points issued (with the appeal window), points excused, appeal decided.
-- -----------------------------------------------------------------------------

create or replace function private.notify_attendance_infraction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label  text;
  v_window integer;
begin
  select label into v_label from public.attendance_infraction_types where id = new.infraction_type_id;
  select appeal_window_days into v_window from public.attendance_policy_settings;

  -- issued: directly, or a suggestion confirmed
  if new.status = 'issued' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform private.notify(
      new.team_member_id, 'attendance_point_issued', 'Attendance Points Issued',
      format('%s point%s — %s (%s).%s You may appeal within %s days from the Dashboard.',
             new.points, case when new.points = 1 then '' else 's' end,
             v_label, to_char(new.occurred_on, 'Mon DD'),
             case when new.high_volume then ' High-volume day: points doubled.' else '' end,
             v_window),
      'attendance_infraction', new.id);
  end if;

  if tg_op = 'UPDATE' and new.status = 'excused' and old.status is distinct from new.status then
    perform private.notify(
      new.team_member_id, 'attendance_point_excused', 'Attendance Points Removed',
      format('%s point%s for %s (%s) were excused and no longer count toward your total.',
             new.points, case when new.points = 1 then '' else 's' end,
             v_label, to_char(new.occurred_on, 'Mon DD')),
      'attendance_infraction', new.id);
  end if;

  if tg_op = 'UPDATE' and new.appeal_status = 'upheld' and old.appeal_status is distinct from new.appeal_status then
    perform private.notify(
      new.team_member_id, 'attendance_appeal_decided', 'Appeal Decision',
      format('Your appeal of %s (%s) was reviewed and the points were upheld.',
             v_label, to_char(new.occurred_on, 'Mon DD')),
      'attendance_infraction', new.id);
  end if;
  -- overturned appeals already trigger the 'excused' notification above

  return null;
end;
$$;

create trigger notify_attendance after insert or update on public.attendance_infractions
  for each row execute function private.notify_attendance_infraction();
