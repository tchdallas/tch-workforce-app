-- =============================================================================
-- Attendance/discipline hierarchy + self-serve standing
--
-- Two changes:
--   1. private.can_discipline_member(target) — you may only issue/manage
--      attendance points AND discipline documents against people BELOW your own
--      permission level. Location sharing alone (can_manage_member) was letting a
--      manager act on an admin who happened to work the same room. Read access is
--      unchanged; only the write/action paths are gated.
--   2. public.my_attendance_standing() — a self-serve read so any member (incl.
--      managers/admins) can see their OWN point balance/standing on the dashboard,
--      computed with the exact same math as the manager roster (attendance_balances).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Hierarchy guard: can_manage_member (shared location / corporate reach) AND the
-- caller strictly outranks the target. Nobody disciplines a peer or a superior.
-- -----------------------------------------------------------------------------
create or replace function private.can_discipline_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_manage_member(target)
     and private.current_permission_rank() > coalesce(
       (select private.permission_rank(permission_level)
        from public.team_members where id = target),
       0);
$$;

-- =============================================================================
-- Attendance RPCs — swap can_manage_member -> can_discipline_member on the
-- write/action guards (bodies otherwise identical to 20260709000002).
-- =============================================================================

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
  if not ((select private.is_at_least('manager')) and private.can_discipline_member(p_member_id)) then
    raise exception 'You can only issue attendance points to members below your permission level at your locations';
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

  v_loc := coalesce(
    (select s.location_id from public.shifts s where s.id = p_shift_id),
    (select tm.home_location_id from public.team_members tm where tm.id = p_member_id)
  );

  v_high := exists (
    select 1 from public.high_volume_days d
    where d.event_date = p_occurred_on
      and (d.location_id is null or d.location_id = v_loc)
  );

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

create or replace function public.review_attendance_infraction(
  p_id     uuid,
  p_action text,
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
  if not ((select private.is_at_least('manager')) and private.can_discipline_member(r.team_member_id)) then
    raise exception 'You can only review infractions for members below your permission level at your locations';
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

create or replace function public.decide_attendance_appeal(
  p_id       uuid,
  p_decision text,
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
  if not ((select private.is_at_least('location_admin')) and private.can_discipline_member(r.team_member_id)) then
    raise exception 'You can only decide appeals for members below your permission level at your locations';
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

-- =============================================================================
-- Discipline document RPCs — same swap on the manager-action guards
-- (bodies otherwise identical to 20260709000003).
-- =============================================================================

create or replace function public.issue_discipline_document(p_id uuid, p_signed_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.discipline_documents%rowtype;
  actor uuid := private.current_team_member_id();
begin
  select * into d from public.discipline_documents where id = p_id;
  if d.id is null then raise exception 'Document not found'; end if;
  if not (private.can_discipline_member(d.team_member_id) and private.can_issue_discipline(d.entry_type)) then
    raise exception 'You can only issue documents to members below your permission level at your locations';
  end if;
  if d.status <> 'draft' then raise exception 'Only drafts can be issued'; end if;
  if p_signed_name is null or trim(p_signed_name) = '' then
    raise exception 'Type your name to sign as the issuing manager';
  end if;

  update public.discipline_documents
    set status = 'issued', issued_by = actor, issued_at = now(),
        issuer_signed_name = trim(p_signed_name)
  where id = p_id;
end;
$$;

create or replace function public.witness_discipline_document(p_id uuid, p_signed_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.discipline_documents%rowtype;
  actor uuid := private.current_team_member_id();
begin
  select * into d from public.discipline_documents where id = p_id;
  if d.id is null then raise exception 'Document not found'; end if;
  if not ((select private.is_at_least('manager')) and private.can_discipline_member(d.team_member_id)) then
    raise exception 'You can only witness documents for members below your permission level at your locations';
  end if;
  if actor = d.team_member_id then
    raise exception 'The subject of a document cannot witness it';
  end if;
  if d.status not in ('issued', 'acknowledged', 'refused') then
    raise exception 'Only issued documents can be witnessed';
  end if;
  if p_signed_name is null or trim(p_signed_name) = '' then
    raise exception 'Type your name to sign as witness';
  end if;

  update public.discipline_documents
    set witness_id = actor,
        witness_signed_name = trim(p_signed_name),
        witness_signed_at = now()
  where id = p_id;
end;
$$;

create or replace function public.void_discipline_document(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.discipline_documents%rowtype;
begin
  select * into d from public.discipline_documents where id = p_id;
  if d.id is null then raise exception 'Document not found'; end if;
  if not ((select private.is_at_least('location_admin')) and private.can_discipline_member(d.team_member_id)) then
    raise exception 'You can only void documents for members below your permission level at your locations';
  end if;
  if d.status = 'voided' then raise exception 'Already voided'; end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required to void a document';
  end if;

  update public.discipline_documents
    set status = 'voided', voided_by = private.current_team_member_id(),
        voided_at = now(), void_reason = trim(p_reason)
  where id = p_id;
end;
$$;

-- =============================================================================
-- RLS write policies — defense in depth so direct writes obey the hierarchy too.
-- Read policies are untouched (managers can still VIEW a superior's record).
-- =============================================================================
alter policy "attendance_infractions_insert" on public.attendance_infractions
  with check (
    (select private.is_at_least('manager'))
    and private.can_discipline_member(team_member_id)
    and status in ('suggested', 'issued')
  );
alter policy "attendance_infractions_update" on public.attendance_infractions
  using (
    (select private.is_at_least('manager')) and private.can_discipline_member(team_member_id)
  )
  with check (
    (select private.is_at_least('manager'))
    and private.can_discipline_member(team_member_id)
    and (status <> 'excused' or (select private.is_at_least('location_admin')))
  );

alter policy "discipline_insert" on public.discipline_documents
  with check (
    private.can_discipline_member(team_member_id)
    and private.can_issue_discipline(entry_type)
    and status = 'draft'
    and created_by = private.current_team_member_id()
  );
alter policy "discipline_update" on public.discipline_documents
  using (
    status = 'draft'
    and private.can_discipline_member(team_member_id)
    and (select private.is_at_least('manager'))
  )
  with check (
    status = 'draft'
    and private.can_discipline_member(team_member_id)
    and private.can_issue_discipline(entry_type)
  );

alter policy "journal_insert" on public.journal_entries
  with check (
    (select private.is_at_least('manager'))
    and private.can_discipline_member(team_member_id)
    and author_id = private.current_team_member_id()
  );
alter policy "journal_update" on public.journal_entries
  using ((select private.is_at_least('manager')) and private.can_discipline_member(team_member_id))
  with check ((select private.is_at_least('manager')) and private.can_discipline_member(team_member_id));

-- =============================================================================
-- Self-serve standing — the caller's OWN balance, same math as attendance_balances.
-- No manager gate: it only ever returns your own row.
-- =============================================================================
create or replace function public.my_attendance_standing()
returns table (
  team_member_id     uuid,
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
declare v_me uuid := private.current_team_member_id();
begin
  if v_me is null then return; end if;
  return query
  select tm.id,
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
  where tm.id = v_me;
end;
$$;

grant execute on function public.my_attendance_standing() to authenticated;
