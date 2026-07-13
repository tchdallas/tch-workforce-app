-- =============================================================================
-- In-app bug reporter.
-- Anyone can file a report from wherever they are; the client attaches the
-- technical context (route, role, device, app version, recent console errors,
-- and an optional screenshot in the private bug-screenshots bucket). Managers+
-- triage them on the Bug Reports page; corporate admins are notified on each.
-- =============================================================================

create table public.bug_reports (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid references public.team_members (id),
  route           text,                       -- page path where it was filed
  description     text not null check (length(trim(description)) > 0),
  steps           text,                       -- what they were doing
  expected        text,                       -- what they expected to happen
  severity        text not null default 'medium',  -- 'low' | 'medium' | 'high'
  status          text not null default 'new',     -- 'new' | 'investigating' | 'resolved' | 'not_a_bug'
  user_agent      text,
  viewport        text,
  app_version     text,                       -- built bundle name, for pinning the exact code
  console_log     jsonb,                      -- recent errors/warnings captured client-side
  screenshot_path text,                       -- path in the private bug-screenshots bucket
  admin_notes     text,
  resolved_by     uuid references public.team_members (id),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index bug_reports_status_idx on public.bug_reports (status, created_at desc);
create index bug_reports_reporter_idx on public.bug_reports (reporter_id);

create trigger set_updated_at before update on public.bug_reports
  for each row execute function private.set_updated_at();

-- notify corporate admins (super_admin included) when a report is filed
create or replace function private.notify_bug_report()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare r record; who text;
begin
  select coalesce(nullif(tm.preferred_name, ''), tm.first_name) || ' ' || tm.last_name
  into who from public.team_members tm where tm.id = new.reporter_id;
  for r in
    select tm.id from public.team_members tm
    where tm.status = 'active'
      and private.permission_rank(tm.permission_level) >= private.permission_rank('corporate_admin')
  loop
    perform private.notify(
      r.id, 'bug_report',
      'Bug reported' || case when new.severity = 'high' then ' (high)' else '' end,
      coalesce(who, 'Someone') || ' reported an issue on ' || coalesce(new.route, 'the app') || ': ' || left(new.description, 120),
      'BugReport', new.id
    );
  end loop;
  return null;
end;
$$;
create trigger notify_bug_report after insert on public.bug_reports
  for each row execute function private.notify_bug_report();

alter table public.bug_reports enable row level security;

-- reporters see their own; managers+ see everything
create policy "bug_reports_select" on public.bug_reports
  for select to authenticated
  using (
    reporter_id = private.current_team_member_id()
    or (select private.is_at_least('manager'))
  );
-- anyone files their own
create policy "bug_reports_insert" on public.bug_reports
  for insert to authenticated
  with check (reporter_id = private.current_team_member_id());
-- managers+ triage (status, notes, resolution)
create policy "bug_reports_update" on public.bug_reports
  for update to authenticated
  using ((select private.is_at_least('manager')))
  with check ((select private.is_at_least('manager')));

-- private screenshot bucket — same shape as clock-photos
insert into storage.buckets (id, name, public)
values ('bug-screenshots', 'bug-screenshots', false)
on conflict (id) do nothing;

create policy "bug_screenshots_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'bug-screenshots');

create policy "bug_screenshots_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'bug-screenshots' and private.is_at_least('manager'));
