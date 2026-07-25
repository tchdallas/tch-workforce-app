-- =============================================================================
-- Feedback: the in-app reporter now handles feature requests too, not just bugs.
-- One table, distinguished by `kind` ('bug' | 'feature'). Notification wording
-- adapts. Everything else (triage, screenshots, RLS) is shared.
-- =============================================================================
alter table public.bug_reports
  add column if not exists kind text not null default 'bug' check (kind in ('bug', 'feature'));

create index if not exists bug_reports_kind_idx on public.bug_reports (kind, status, created_at desc);

create or replace function private.notify_bug_report()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  who text;
  v_verb text;
  v_title text;
begin
  select coalesce(nullif(tm.preferred_name, ''), tm.first_name) || ' ' || tm.last_name
  into who from public.team_members tm where tm.id = new.reporter_id;

  v_verb := case when new.kind = 'feature' then 'requested a feature' else 'reported an issue' end;
  v_title := case when new.kind = 'feature' then 'Feature requested'
                  else 'Bug reported' || case when new.severity = 'high' then ' (high)' else '' end
             end;

  for r in
    select tm.id from public.team_members tm
    where tm.status = 'active'
      and private.permission_rank(tm.permission_level) >= private.permission_rank('corporate_admin')
  loop
    perform private.notify(
      r.id, 'bug_report', v_title,
      coalesce(who, 'Someone') || ' ' || v_verb || ' on ' || coalesce(new.route, 'the app') || ': ' || left(new.description, 120),
      'BugReport', new.id
    );
  end loop;
  return null;
end;
$$;
