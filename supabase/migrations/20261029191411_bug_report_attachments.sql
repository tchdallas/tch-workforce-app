-- Feedback (bugs + feature requests) can carry user-added files alongside the
-- auto screenshot: [{path, name, type, size}] in the existing private
-- bug-screenshots bucket (insert already open to authenticated, read manager+).
alter table public.bug_reports
  add column attachments jsonb not null default '[]'::jsonb;
