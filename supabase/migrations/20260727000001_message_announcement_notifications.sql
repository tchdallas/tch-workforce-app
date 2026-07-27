-- Notification-coverage audit fixes: three features created things people
-- needed to know about without telling them.
--   * messages       — a new message now notifies every unmuted participant
--                      (one unread alert per conversation, so chatty threads
--                      don't flood the bell)
--   * announcements  — publishing now notifies each recipient
--   * attendance     — filing an appeal now notifies the admins who can
--                      actually decide it
-- Plus unread_message_count() for the Messages nav badge.

-- -----------------------------------------------------------------------------
-- Messages
-- -----------------------------------------------------------------------------

create or replace function private.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv        public.conversations%rowtype;
  sender_name text;
  v_title     text;
  r           record;
begin
  if new.deleted_at is not null then
    return null;
  end if;

  select * into conv from public.conversations where id = new.conversation_id;
  select coalesce(preferred_name, first_name) || ' ' || last_name
    into sender_name
  from public.team_members where id = new.sender_team_member_id;

  v_title := case
    when conv.title is not null and conv.conversation_type <> 'direct'
      then sender_name || ' in ' || conv.title
    else 'New message from ' || sender_name
  end;

  for r in
    select cp.team_member_id
    from public.conversation_participants cp
    where cp.conversation_id = new.conversation_id
      and cp.team_member_id <> new.sender_team_member_id
      and not cp.muted
  loop
    -- one unread alert per conversation per person: if they already have an
    -- unread message notification for this thread, don't stack another
    if not exists (
      select 1 from public.notifications n
      where n.recipient_team_member_id = r.team_member_id
        and n.type = 'message_received'
        and n.related_entity_id = new.conversation_id
        and n.read_status = false
    ) then
      perform private.notify(
        r.team_member_id, 'message_received', v_title,
        left(new.body, 120), 'conversation', new.conversation_id);
    end if;
  end loop;

  return null;
end;
$$;

create trigger notify_new_message after insert on public.messages
  for each row execute function private.notify_new_message();

-- -----------------------------------------------------------------------------
-- Announcements — recipients are snapshotted at publish time, so notifying on
-- each recipient row covers exactly the published audience.
-- -----------------------------------------------------------------------------

create or replace function private.notify_announcement_recipient()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.announcements%rowtype;
begin
  select * into a from public.announcements where id = new.announcement_id;

  if new.team_member_id is distinct from a.created_by then
    perform private.notify(
      new.team_member_id, 'announcement',
      case when a.requires_acknowledgment
           then 'Announcement — please read and confirm'
           else 'New announcement' end,
      a.title || case when a.requires_acknowledgment
                      then ' — confirm you''ve read it on the Announcements page.'
                      else '' end,
      'announcement', a.id);
  end if;

  return null;
end;
$$;

create trigger notify_announcement after insert on public.announcement_recipients
  for each row execute function private.notify_announcement_recipient();

-- -----------------------------------------------------------------------------
-- Attendance appeals — tell the admins who can decide (location_admin at the
-- infraction's location, corporate_admin+ everywhere).
-- -----------------------------------------------------------------------------

create or replace function private.notify_attendance_appeal_filed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_name text;
  r           record;
begin
  if new.appeal_status = 'pending' and old.appeal_status is distinct from new.appeal_status then
    select coalesce(preferred_name, first_name) || ' ' || last_name
      into member_name
    from public.team_members where id = new.team_member_id;

    for r in
      select tm.id
      from public.team_members tm
      where tm.status = 'active'
        and (
          private.permission_rank(tm.permission_level) >= private.permission_rank('corporate_admin')
          or (
            tm.permission_level = 'location_admin'
            and new.location_id is not null
            and exists (
              select 1 from private.member_location_ids(tm.id) m
              where m.location_id = new.location_id
            )
          )
        )
    loop
      perform private.notify(
        r.id, 'attendance_appeal_filed', 'Attendance Appeal Filed',
        format('%s appealed %s point%s (%s). Review it under Attendance → Appeals.',
               member_name, new.points, case when new.points = 1 then '' else 's' end,
               to_char(new.occurred_on, 'Mon DD')),
        'attendance_infraction', new.id);
    end loop;
  end if;

  return null;
end;
$$;

create trigger notify_appeal_filed after update on public.attendance_infractions
  for each row execute function private.notify_attendance_appeal_filed();

-- -----------------------------------------------------------------------------
-- unread_message_count() — conversations with messages from others newer than
-- my last read, excluding muted threads. Drives the Messages nav badge.
-- -----------------------------------------------------------------------------

create or replace function public.unread_message_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.conversation_participants cp
  join public.conversations c on c.id = cp.conversation_id
  where cp.team_member_id = private.current_team_member_id()
    and not cp.muted
    and c.last_message_at is not null
    and c.last_message_at > coalesce(cp.last_read_at, 'epoch'::timestamptz)
    and exists (
      select 1 from public.messages m
      where m.conversation_id = c.id
        and m.sender_team_member_id <> cp.team_member_id
        and m.deleted_at is null
        and m.created_at > coalesce(cp.last_read_at, 'epoch'::timestamptz)
    );
$$;

grant execute on function public.unread_message_count() to authenticated;
