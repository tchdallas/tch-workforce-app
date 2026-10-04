-- =============================================================================
-- Messaging moderation: you can't moderate yourself
--
--   * A flag on YOUR message is never shown to you and never notifies you —
--     only the other admins who moderate that conversation review it.
--   * Nobody can mute or unmute themselves, and an admin may only mute
--     someone ranked strictly below them (same hierarchy as discipline).
--   * Data fix: clear any self-mutes that happened before this rule existed,
--     and mark the "your own message was flagged" notices read.
-- =============================================================================

-- ------------------------------------------------- flags: not on yourself
drop policy if exists "message_flags_select" on public.message_flags;
create policy "message_flags_select" on public.message_flags
  for select to authenticated
  using (
    flagged_by = private.current_team_member_id()
    or (
      private.can_moderate_conversation(conversation_id)
      and not exists (
        select 1 from public.messages m
        where m.id = message_flags.message_id
          and m.sender_team_member_id = private.current_team_member_id()
      )
    )
  );

drop policy if exists "message_flags_update" on public.message_flags;
create policy "message_flags_update" on public.message_flags
  for update to authenticated
  using (
    private.can_moderate_conversation(conversation_id)
    and not exists (
      select 1 from public.messages m
      where m.id = message_flags.message_id
        and m.sender_team_member_id = private.current_team_member_id()
    )
  )
  with check (private.can_moderate_conversation(conversation_id));

create or replace function private.notify_message_flag()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_body    text;
  v_sender  text;
  v_sender_id uuid;
  v_flagger text;
  m         uuid;
begin
  select left(msg.body, 100), coalesce(s.preferred_name, s.first_name) || ' ' || s.last_name, s.id
    into v_body, v_sender, v_sender_id
  from public.messages msg
  join public.team_members s on s.id = msg.sender_team_member_id
  where msg.id = new.message_id;

  select coalesce(preferred_name, first_name) || ' ' || last_name into v_flagger
  from public.team_members where id = new.flagged_by;

  for m in select * from private.conversation_moderator_ids(new.conversation_id) loop
    -- never the flagger, and never the person whose message it is
    if m <> new.flagged_by and m <> v_sender_id then
      perform private.notify(
        m, 'message_flagged', 'Message flagged for review',
        v_flagger || ' flagged a message from ' || v_sender || ': ' || v_body,
        'conversation', new.conversation_id);
    end if;
  end loop;
  return null;
end;
$$;

-- ------------------------------------------- mute: not yourself, only down
create or replace function private.guard_silence_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := private.current_team_member_id();
begin
  -- only when the silence state actually changes, and only for real users
  -- (service/migration sessions have no team member and are not restricted)
  if me is null or new.silenced_at is not distinct from old.silenced_at then
    return new;
  end if;
  if new.team_member_id = me then
    raise exception 'You cannot mute or unmute yourself' using errcode = 'P0001';
  end if;
  if private.member_rank(me) <= private.member_rank(new.team_member_id) then
    raise exception 'You can only mute team members ranked below you' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_silence_change on public.conversation_participants;
create trigger guard_silence_change before update on public.conversation_participants
  for each row execute function private.guard_silence_change();

-- ---------------------------------------------------------------- data fix
-- undo any self-mutes made before the rule existed
update public.conversation_participants
   set silenced_at = null, silenced_by = null
 where silenced_by is not null and silenced_by = team_member_id;

-- a flag the sender "resolved" on their own message counts as dismissed
-- (its mute was undone above; the message removal stands)
update public.message_flags f
   set status = 'dismissed'
  from public.messages m
 where m.id = f.message_id
   and f.reviewed_by is not null
   and f.reviewed_by = m.sender_team_member_id
   and f.status = 'muted';

-- quiet the "your own message was flagged" notices already sent
update public.notifications n
   set read_status = true
  from public.message_flags f
  join public.messages m on m.id = f.message_id
 where n.type = 'message_flagged'
   and n.related_entity_id = f.conversation_id
   and n.recipient_team_member_id = m.sender_team_member_id
   and n.read_status = false;
