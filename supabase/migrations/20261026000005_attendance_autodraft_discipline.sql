-- =============================================================================
-- Attendance auto-drafting: when issued points push a member's rolling balance
-- across a policy threshold (coaching / WW / FWW / termination review), the
-- database drafts the matching Performance Documentation automatically —
-- nature 'attendance', prefilled from the policy and the member's record.
-- Drafts stay invisible to the member; the issuing manager is notified and
-- reviews/issues it from the member's File tab (termination review drafts as a
-- Separation, which only a location_admin+ may issue — by design).
-- Also: discipline docs gain a `source` so auto-drafts are labeled in the UI.
-- =============================================================================

alter table public.discipline_documents
  add column if not exists source text not null default 'manual';

-- severity order of the progressive ladder (shared by dedupe + the UI's logic)
create or replace function private.discipline_rank(t public.discipline_entry_type)
returns integer
language sql immutable
set search_path = ''
as $$
  select case t
    when 'informational' then 0
    when 'documented_coaching' then 1
    when 'written_warning' then 2
    when 'final_written_warning' then 3
    when 'suspension_pending_investigation' then 4
    when 'separation' then 5
  end;
$$;

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
  v_bal_txt      text;
  v_thr_txt      text;
  v_doc_id       uuid;
begin
  -- only when an infraction lands in (or returns to) 'issued'
  if new.status <> 'issued' then return null; end if;
  if tg_op = 'UPDATE' and old.status = new.status then return null; end if;

  select * into cfg from public.attendance_policy_settings;

  -- same window math as attendance_summary (inlined: no caller-permission
  -- check here, so this also works for future automated issuance paths)
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

  -- this step (or a later one) already exists for attendance inside the
  -- window — drafted, issued, signed or refused — so nothing new to draft
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
     format('Attendance point balance reached %s points within the counting window (policy threshold for %s: %s points). Most recent infraction: %s on %s (%s point(s)).',
            v_bal_txt, v_step_label, v_thr_txt,
            v_type_label, to_char(new.occurred_on, 'MM/DD/YYYY'),
            regexp_replace(new.points::text, '\.?0+$', '')),
     format('Per the Attendance Policy, accumulating %s or more points within the counting window results in %s.',
            v_thr_txt, v_step_label),
     'Maintain reliable attendance going forward: arrive on time for scheduled shifts and follow the call-out procedure. Points roll off 12 months after the date they were incurred.')
  returning id into v_doc_id;

  if new.issued_by is not null then
    perform private.notify(new.issued_by, 'discipline_draft',
      format('%s reached %s attendance points', private.member_display_name(new.team_member_id), v_bal_txt),
      format('A %s draft is ready on their File tab — review and issue it, or void it if it does not apply.', v_step_label),
      'team_member', new.team_member_id);
  end if;

  return null;
end;
$$;

-- fires after the issuance insert (and after an appeal denial re-issues)
create trigger zz2_autodraft_discipline
  after insert or update on public.attendance_infractions
  for each row execute function private.autodraft_attendance_discipline();
