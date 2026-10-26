-- Auto-drafted attendance documents now itemize every infraction counting
-- toward the balance (date — type — points, high-volume doubling noted), so
-- the document shows HOW the member got to their total, not just the total.

create or replace function private.autodraft_attendance_discipline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg            public.attendance_policy_settings%rowtype;
  v_start        date;
  v_window_start date;
  v_balance      numeric;
  v_target       public.discipline_entry_type;
  v_threshold    numeric;
  v_step_label   text;
  v_type_label   text;
  v_prior        text;
  v_points_list  text;
  v_bal_txt      text;
  v_thr_txt      text;
begin
  if new.status <> 'issued' then return null; end if;
  if tg_op = 'UPDATE' and old.status = new.status then return null; end if;

  select * into cfg from public.attendance_policy_settings;

  select start_date into v_start from public.team_members where id = new.team_member_id;
  if v_start is not null and current_date < (v_start + cfg.new_hire_period_days) then
    v_window_start := v_start;
  else
    v_window_start := (current_date - make_interval(months => cfg.rolling_window_months))::date;
  end if;

  select coalesce(sum(points), 0) into v_balance
  from public.attendance_infractions
  where team_member_id = new.team_member_id
    and status = 'issued'
    and occurred_on >= v_window_start;

  if    v_balance >= cfg.termination_threshold     then v_target := 'separation';            v_threshold := cfg.termination_threshold;     v_step_label := 'Separation of Employment (termination review)';
  elsif v_balance >= cfg.final_warning_threshold   then v_target := 'final_written_warning'; v_threshold := cfg.final_warning_threshold;   v_step_label := 'Final Written Warning';
  elsif v_balance >= cfg.written_warning_threshold then v_target := 'written_warning';       v_threshold := cfg.written_warning_threshold; v_step_label := 'Written Warning';
  elsif v_balance >= cfg.coaching_threshold        then v_target := 'documented_coaching';   v_threshold := cfg.coaching_threshold;        v_step_label := 'Documented Coaching';
  else return null;
  end if;

  if exists (
    select 1 from public.discipline_documents d
    where d.team_member_id = new.team_member_id
      and d.status <> 'voided'
      and 'attendance' = any(d.natures)
      and private.discipline_rank(d.entry_type) >= private.discipline_rank(v_target)
      and d.created_at >= v_window_start
  ) then return null; end if;

  select coalesce(t.label, 'Attendance infraction') into v_type_label
  from public.attendance_infraction_types t
  where t.id = new.infraction_type_id;

  select string_agg(
           format('%s — %s', to_char(coalesce(d.issued_at, d.created_at), 'MM/DD/YYYY'),
                  initcap(replace(d.entry_type::text, '_', ' '))),
           '; ' order by coalesce(d.issued_at, d.created_at))
    into v_prior
  from public.discipline_documents d
  where d.team_member_id = new.team_member_id
    and d.status in ('issued', 'acknowledged', 'refused');

  -- every infraction still counting toward the balance, oldest first
  select string_agg(
           format('• %s — %s — %s point%s%s',
                  to_char(i.occurred_on, 'MM/DD/YYYY'),
                  coalesce(t.label, 'Attendance infraction'),
                  regexp_replace(i.points::text, '\.?0+$', ''),
                  case when i.points = 1 then '' else 's' end,
                  case when i.high_volume then ' (doubled: high-volume day)' else '' end),
           E'\n' order by i.occurred_on)
    into v_points_list
  from public.attendance_infractions i
  left join public.attendance_infraction_types t on t.id = i.infraction_type_id
  where i.team_member_id = new.team_member_id
    and i.status = 'issued'
    and i.occurred_on >= v_window_start;

  v_bal_txt := regexp_replace(v_balance::text, '\.?0+$', '');
  v_thr_txt := regexp_replace(v_threshold::text, '\.?0+$', '');

  insert into public.discipline_documents
    (team_member_id, location_id, entry_type, natures, source, status, created_by,
     prior_documentation, incident_when_where, observed_behavior, why_important, correction_plan)
  values
    (new.team_member_id,
     new.location_id,
     v_target,
     array['attendance']::public.discipline_nature[],
     'attendance_auto',
     'draft',
     new.issued_by,
     coalesce(v_prior, 'N/A'),
     format('Attendance balance crossed the policy threshold with the infraction dated %s.',
            to_char(new.occurred_on, 'MM/DD/YYYY')),
     format(E'Attendance point balance reached %s points within the counting window (policy threshold for %s: %s points).\n\nPoints on record:\n%s',
            v_bal_txt, v_step_label, v_thr_txt, coalesce(v_points_list, '—')),
     format('Per the Attendance Policy, accumulating %s or more points within the counting window results in %s.',
            v_thr_txt, v_step_label),
     'Maintain reliable attendance going forward: arrive on time for scheduled shifts and follow the call-out procedure. Points roll off 12 months after the date they were incurred.')
  ;

  if new.issued_by is not null then
    perform private.notify(new.issued_by, 'discipline_draft',
      format('%s reached %s attendance points', private.member_display_name(new.team_member_id), v_bal_txt),
      format('A %s draft is ready on their File tab — review and issue it, or void it if it does not apply.', v_step_label),
      'team_member', new.team_member_id);
  end if;

  return null;
end;
$$;

-- Backfill: append the itemized list to auto-drafts that are still drafts and
-- don't have one yet (issued docs are locked history — left untouched).
do $$
declare
  d record;
  cfg public.attendance_policy_settings%rowtype;
  v_start date;
  v_window_start date;
  v_points_list text;
begin
  select * into cfg from public.attendance_policy_settings;
  for d in
    select id, team_member_id, observed_behavior
    from public.discipline_documents
    where source = 'attendance_auto' and status = 'draft'
      and (observed_behavior is null or observed_behavior not like '%Points on record:%')
  loop
    select start_date into v_start from public.team_members where id = d.team_member_id;
    if v_start is not null and current_date < (v_start + cfg.new_hire_period_days) then
      v_window_start := v_start;
    else
      v_window_start := (current_date - make_interval(months => cfg.rolling_window_months))::date;
    end if;

    select string_agg(
             format('• %s — %s — %s point%s%s',
                    to_char(i.occurred_on, 'MM/DD/YYYY'),
                    coalesce(t.label, 'Attendance infraction'),
                    regexp_replace(i.points::text, '\.?0+$', ''),
                    case when i.points = 1 then '' else 's' end,
                    case when i.high_volume then ' (doubled: high-volume day)' else '' end),
             E'\n' order by i.occurred_on)
      into v_points_list
    from public.attendance_infractions i
    left join public.attendance_infraction_types t on t.id = i.infraction_type_id
    where i.team_member_id = d.team_member_id
      and i.status = 'issued'
      and i.occurred_on >= v_window_start;

    if v_points_list is not null then
      update public.discipline_documents
      set observed_behavior = coalesce(d.observed_behavior, '') || E'\n\nPoints on record:\n' || v_points_list
      where id = d.id;
    end if;
  end loop;
end;
$$;
