-- =============================================================================
-- Domain 5: Notifications
-- delivered notifications (existing entity) + per-member preferences (new).
-- Schema only in Phase 1 — the triggers that create notifications and the
-- reminder Edge Function land in Phase 4. Per Victor: no audit trigger here
-- (high-volume delivery records).
-- =============================================================================

-- push / email / in_app; base44's sms_placeholder dropped per the data model
create type public.notification_channel as enum ('push', 'email', 'in_app');

-- event_type / type are text, not enums, so new notification events can ship
-- without a schema migration (data model calls them extensible)

create table public.notifications (
  id                       uuid primary key default gen_random_uuid(),
  recipient_team_member_id uuid not null references public.team_members (id) on delete cascade,
  title                    text not null,
  message                  text not null,
  type                     text,
  channel                  public.notification_channel not null default 'in_app',
  read_status              boolean not null default false,
  related_entity_type      text,
  related_entity_id        uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index notifications_recipient_idx
  on public.notifications (recipient_team_member_id, created_at desc);
create index notifications_unread_idx
  on public.notifications (recipient_team_member_id) where not read_status;

create table public.notification_preferences (
  id             uuid primary key default gen_random_uuid(),
  team_member_id uuid not null references public.team_members (id) on delete cascade,
  event_type     text not null, -- schedule_updated, upcoming_shift, shift_offered, new_message, request_status, ...
  enabled        boolean not null default true,
  channels       public.notification_channel[] not null default '{in_app}',
  settings       jsonb not null default '{}',
  -- upcoming_shift -> {"lead_times_minutes": [1440, 120, 30]}
  -- shift_offered  -> {"roles": [...], "locations": [...], "min_notice_hours": n}
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (team_member_id, event_type)
);

create trigger set_updated_at before update on public.notifications
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.notification_preferences
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- -----------------------------------------------------------------------------

alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;

-- you only ever see your own notifications
create policy "notifications_select" on public.notifications
  for select to authenticated
  using (recipient_team_member_id = private.current_team_member_id());

-- Phase 2 interim: the ported app creates notification rows client-side (e.g.
-- a member accepting a trade notifies the other member), so any signed-in user
-- may insert. Phase 4 moves creation into definer triggers / Edge Functions,
-- at which point this policy can be dropped.
create policy "notifications_insert" on public.notifications
  for insert to authenticated
  with check (true);

-- recipients manage their own read state; no delete (read_status is the
-- "dismiss" — delivery records are never removed)
create policy "notifications_update" on public.notifications
  for update to authenticated
  using (recipient_team_member_id = private.current_team_member_id())
  with check (recipient_team_member_id = private.current_team_member_id());

-- preferences are personal: own rows only (the reminder Edge Function reads
-- them with the service role, which bypasses RLS)
create policy "notification_preferences_all" on public.notification_preferences
  for all to authenticated
  using (team_member_id = private.current_team_member_id())
  with check (team_member_id = private.current_team_member_id());

-- live in-app bell: stream new notifications over Supabase Realtime
-- (postgres_changes subscriptions respect the RLS above)
alter publication supabase_realtime add table public.notifications;
