-- =============================================================================
-- Web Push
--
-- Notifications were in-app only: private.notify() wrote a row, and you learned
-- about it by opening the app and looking. That's fine for "a shift changed"
-- and useless for "confirm your hours or payroll goes out without you".
--
-- This stores each device's push subscription and, whenever a notification row
-- is written, fires an async HTTP call (pg_net) to a Vercel function that signs
-- the VAPID request and delivers it. The private signing key lives in Vercel's
-- environment, never in the database or the repo.
--
-- Delivery is best-effort and deliberately non-blocking: pg_net queues the
-- request and returns immediately, so a push outage can never slow down or roll
-- back the transaction that created the notification.
-- =============================================================================

create extension if not exists pg_net with schema extensions;
create table public.push_subscriptions (
  id             uuid primary key default gen_random_uuid(),
  team_member_id uuid not null references public.team_members (id) on delete cascade,
  endpoint       text not null,
  p256dh         text not null,
  auth           text not null,
  user_agent     text,
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz,
  -- one row per browser/device; re-subscribing on the same device updates it
  unique (endpoint)
);
create index push_subscriptions_member_idx on public.push_subscriptions (team_member_id);
alter table public.push_subscriptions enable row level security;
-- Strictly your own devices. Nobody reads anyone else's, not even admins —
-- these are effectively device credentials, and the sender path is definer.
create policy "push_subscriptions_select" on public.push_subscriptions
  for select to authenticated
  using (team_member_id = private.current_team_member_id());
create policy "push_subscriptions_insert" on public.push_subscriptions
  for insert to authenticated
  with check (team_member_id = private.current_team_member_id());
create policy "push_subscriptions_update" on public.push_subscriptions
  for update to authenticated
  using (team_member_id = private.current_team_member_id())
  with check (team_member_id = private.current_team_member_id());
create policy "push_subscriptions_delete" on public.push_subscriptions
  for delete to authenticated
  using (team_member_id = private.current_team_member_id());
-- -----------------------------------------------------------------------------
-- Where to send, and the shared secret proving the caller is us. Kept in a
-- private table rather than a public app_setting: app_settings is readable by
-- every authenticated user, and this row would let anyone send push to staff.
-- -----------------------------------------------------------------------------

create table private.push_config (
  id         integer primary key default 1 check (id = 1),
  endpoint   text not null,
  secret     text not null,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);
-- no policies and no grants: only definer functions can read this
alter table private.push_config enable row level security;
create or replace function private.send_web_push(p_notification public.notifications)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg private.push_config;
  subs jsonb;
  link text;
begin
  select * into cfg from private.push_config where id = 1;
  if not found or not cfg.enabled then return; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth
         )), '[]'::jsonb)
  into subs
  from public.push_subscriptions s
  where s.team_member_id = p_notification.recipient_team_member_id;

  if subs = '[]'::jsonb then return; end if;

  -- deep link to the thing the notification is about, where we can work it out
  link := case p_notification.related_entity_type
    when 'Policy'    then '/policies/' || coalesce(p_notification.related_entity_id::text, '')
    when 'TimeEntry' then '/'
    when 'Shift'     then '/my-schedule'
    else '/notifications'
  end;

  perform extensions.net.http_post(
    url := cfg.endpoint,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', cfg.secret
    ),
    body := jsonb_build_object(
      'title', p_notification.title,
      'body', p_notification.message,
      'url', link,
      'tag', coalesce(p_notification.type, 'tch'),
      'subscriptions', subs
    ),
    timeout_milliseconds := 5000
  );
end;
$$;
-- Fire-and-forget on every notification. Wrapped so a push failure can never
-- roll back the notification itself — the in-app record is the source of truth
-- and must survive regardless.
create or replace function private.notify_web_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform private.send_web_push(new);
  exception when others then
    null;
  end;
  return null;
end;
$$;
create trigger web_push after insert on public.notifications
  for each row execute function private.notify_web_push();
-- -----------------------------------------------------------------------------
-- Housekeeping: a browser that has revoked permission leaves a dead endpoint
-- behind. The sender reports those back; this lets it clean up without needing
-- the service-role key.
-- -----------------------------------------------------------------------------

create or replace function public.prune_push_subscription(p_endpoint text)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;
revoke execute on function public.prune_push_subscription(text) from public, authenticated;
