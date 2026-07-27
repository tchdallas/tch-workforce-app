-- =============================================================================
-- Fix: pg_net's function lives at net.http_post, not extensions.net.http_post.
--
-- 20260725000004 called the wrong path. A plpgsql body isn't resolved until it
-- runs, so the migration applied cleanly and the error only surfaced at send
-- time — where the deliberate "never let push break a notification" exception
-- handler swallowed it. Result: every push silently did nothing.
--
-- The handler stays (an in-app notification must never roll back because a push
-- endpoint is down), but it now records the failure instead of discarding it,
-- so the next silent breakage is visible in the logs rather than invisible.
-- =============================================================================

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

  link := case p_notification.related_entity_type
    when 'Policy'    then '/policies/' || coalesce(p_notification.related_entity_id::text, '')
    when 'TimeEntry' then '/'
    when 'Shift'     then '/my-schedule'
    else '/notifications'
  end;

  perform net.http_post(
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
    -- swallowed on purpose: the in-app notification is the source of truth and
    -- must survive a push outage. But say so, so a broken sender is findable.
    raise warning 'web push failed for notification %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
