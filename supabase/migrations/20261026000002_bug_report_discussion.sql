-- Feedback becomes a two-way loop: reporters see their own submissions (RLS
-- already allowed it; the UI now shows it) and each report carries a
-- DISCUSSION thread between the reporter and the managers triaging it.
-- Replies and status changes notify the other side.

-- who may see (and therefore discuss) a report: its reporter, or manager+
create or replace function private.can_see_bug_report(rid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.bug_reports b
    where b.id = rid
      and (b.reporter_id = private.current_team_member_id()
           or private.is_at_least('manager'))
  );
$$;

create table public.bug_report_comments (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.bug_reports (id) on delete cascade,
  author_id   uuid not null references public.team_members (id),
  -- snapshot: a team member can't read a manager's row under RLS, so the name
  -- travels with the comment (same pattern as audit_logs.actor_name)
  author_name text,
  body        text not null check (length(trim(body)) > 0),
  created_at  timestamptz not null default now()
);
create index bug_report_comments_report_idx on public.bug_report_comments (report_id, created_at);

create or replace function private.bug_comment_defaults()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.author_name is null then
    new.author_name := private.member_display_name(new.author_id);
  end if;
  return new;
end;
$$;
create trigger bug_comment_defaults before insert on public.bug_report_comments
  for each row execute function private.bug_comment_defaults();

alter table public.bug_report_comments enable row level security;

create policy "bug_report_comments_select" on public.bug_report_comments
  for select to authenticated
  using (private.can_see_bug_report(report_id));
create policy "bug_report_comments_insert" on public.bug_report_comments
  for insert to authenticated
  with check (
    author_id = private.current_team_member_id()
    and private.can_see_bug_report(report_id)
  );
-- append-only thread: no updates or deletes

-- a reply notifies the other side: the reporter (when someone else replies)
-- and everyone else who has taken part in the thread
create or replace function private.notify_bug_comment()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  rep public.bug_reports%rowtype;
  kind_label text;
  r record;
begin
  select * into rep from public.bug_reports where id = new.report_id;
  kind_label := case when rep.kind = 'feature' then 'feature request' else 'bug report' end;

  if rep.reporter_id is not null and rep.reporter_id <> new.author_id then
    perform private.notify(rep.reporter_id, 'feedback_reply',
      'Reply on your ' || kind_label,
      coalesce(new.author_name, 'Someone') || ': ' || left(new.body, 120),
      'bug_report', rep.id);
  end if;

  for r in
    select distinct c.author_id
    from public.bug_report_comments c
    where c.report_id = new.report_id
      and c.author_id <> new.author_id
      and c.author_id is distinct from rep.reporter_id
  loop
    perform private.notify(r.author_id, 'feedback_reply',
      'New reply on a ' || kind_label,
      coalesce(new.author_name, 'Someone') || ': ' || left(new.body, 120),
      'bug_report', rep.id);
  end loop;

  return null;
end;
$$;
create trigger notify_bug_comment after insert on public.bug_report_comments
  for each row execute function private.notify_bug_comment();

-- status changes tell the reporter where their report stands
create or replace function private.notify_bug_status()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  kind_label text;
  status_label text;
begin
  if new.status is not distinct from old.status then return null; end if;
  if new.reporter_id is null or new.reporter_id = private.current_team_member_id() then return null; end if;
  kind_label := case when new.kind = 'feature' then 'feature request' else 'bug report' end;
  status_label := case new.status
    when 'investigating' then 'being looked into'
    when 'resolved' then 'resolved'
    when 'not_a_bug' then 'reviewed and closed'
    else new.status end;
  perform private.notify(new.reporter_id, 'feedback_status',
    'Your ' || kind_label || ' was updated',
    'Status: ' || status_label || '. Open it under Feedback to see details or reply.',
    'bug_report', new.id);
  return null;
end;
$$;
create trigger notify_bug_status after update on public.bug_reports
  for each row execute function private.notify_bug_status();
