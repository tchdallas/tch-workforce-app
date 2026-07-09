-- =============================================================================
-- Phase 4 (in-app): database-driven notifications.
-- Fired by triggers so they work no matter which screen (or import) caused the
-- change. Swap-flow notifications (trades/giveaways/claims) remain client-side
-- for now — these triggers cover what nothing else covers:
--   schedule_updated : your shift was published / retimed / reassigned / cancelled
--   shift_offered    : an open shift you qualify for was published
--   request_status   : your time-off request was approved or denied
-- =============================================================================

-- Preference-aware insert: a notification_preferences row with enabled=false
-- suppresses the event type for that member; no row = on by default.
create or replace function private.notify(
  p_recipient uuid,
  p_event text,
  p_title text,
  p_message text,
  p_entity_type text default null,
  p_entity_id uuid default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_recipient is null then return; end if;
  if exists (
    select 1 from public.notification_preferences
    where team_member_id = p_recipient and event_type = p_event and enabled = false
  ) then
    return;
  end if;
  insert into public.notifications
    (recipient_team_member_id, title, message, type, channel, related_entity_type, related_entity_id)
  values
    (p_recipient, p_title, p_message, p_event, 'in_app', p_entity_type, p_entity_id);
end;
$$;

-- shift time formatted in the location's timezone
create or replace function private.shift_when(s public.shifts)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select to_char(s.start_at at time zone coalesce(l.timezone, 'America/Chicago'), 'Dy Mon FMDD, FMHH12:MI AM')
         || ' – '
         || to_char(s.end_at at time zone coalesce(l.timezone, 'America/Chicago'), 'FMHH12:MI AM')
  from public.locations l where l.id = s.location_id;
$$;

-- everyone qualified for an open shift (role + location), excluding anyone assigned
create or replace function private.notify_qualified_open(s public.shifts)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select tm.id from public.team_members tm
    where tm.status = 'active'
      and tm.id is distinct from s.team_member_id
      and exists (select 1 from public.team_member_roles x where x.team_member_id = tm.id and x.role_id = s.role_id)
      and (tm.home_location_id = s.location_id
           or exists (select 1 from public.team_member_locations x where x.team_member_id = tm.id and x.location_id = s.location_id))
  loop
    perform private.notify(
      r.id, 'shift_offered', 'Open Shift Available',
      'An open shift you qualify for was posted: ' || private.shift_when(s) || '. First come, first served — claim it in Open Shifts.',
      'Shift', s.id
    );
  end loop;
end;
$$;

create or replace function private.notify_shift_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'published' then
      if new.team_member_id is not null then
        perform private.notify(new.team_member_id, 'schedule_updated', 'New Shift Scheduled',
          'You have a new shift: ' || private.shift_when(new) || '.', 'Shift', new.id);
      elsif new.shift_type = 'open' then
        perform private.notify_qualified_open(new);
      end if;
    end if;
    return null;
  end if;

  -- UPDATE
  -- newly published
  if old.status <> 'published' and new.status = 'published' then
    if new.team_member_id is not null then
      perform private.notify(new.team_member_id, 'schedule_updated', 'New Shift Scheduled',
        'You have a new shift: ' || private.shift_when(new) || '.', 'Shift', new.id);
    elsif new.shift_type = 'open' then
      perform private.notify_qualified_open(new);
    end if;
    return null;
  end if;

  if new.status = 'published' and old.status = 'published' then
    -- cancelled below; here: reassignment (skip swap-driven transfers — the
    -- swap flow sends its own richer notifications and sets recent_change_flag)
    if new.team_member_id is distinct from old.team_member_id
       and not (new.recent_change_flag and not old.recent_change_flag) then
      perform private.notify(old.team_member_id, 'schedule_updated', 'Shift Reassigned',
        'You were taken off the shift on ' || private.shift_when(new) || '.', 'Shift', new.id);
      perform private.notify(new.team_member_id, 'schedule_updated', 'New Shift Scheduled',
        'You have a new shift: ' || private.shift_when(new) || '.', 'Shift', new.id);
    -- retimed
    elsif (new.start_at is distinct from old.start_at or new.end_at is distinct from old.end_at)
          and new.team_member_id is not null then
      perform private.notify(new.team_member_id, 'schedule_updated', 'Shift Time Changed',
        'Your shift is now ' || private.shift_when(new) || '.', 'Shift', new.id);
    end if;
  end if;

  if old.status <> 'cancelled' and new.status = 'cancelled' and new.team_member_id is not null then
    perform private.notify(new.team_member_id, 'schedule_updated', 'Shift Cancelled',
      'Your shift on ' || private.shift_when(new) || ' was cancelled.', 'Shift', new.id);
  end if;

  return null;
end;
$$;

create trigger notify_shift_changes after insert or update on public.shifts
  for each row execute function private.notify_shift_changes();

create or replace function private.notify_time_off_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'denied') then
    perform private.notify(
      new.team_member_id, 'request_status',
      case when new.status = 'approved' then 'Time Off Approved' else 'Time Off Denied' end,
      'Your time-off request for '
        || to_char(new.start_at at time zone 'America/Chicago', 'Mon FMDD')
        || ' – '
        || to_char(new.end_at at time zone 'America/Chicago', 'Mon FMDD')
        || ' was ' || new.status
        || coalesce('. Note: ' || nullif(new.manager_note, ''), '') || '.',
      'TimeOffRequest', new.id
    );
  end if;
  return null;
end;
$$;

create trigger notify_time_off_status after update on public.time_off_requests
  for each row execute function private.notify_time_off_status();
