-- =============================================================================
-- Messaging overhaul, phase 1: moderation, flags, @mentions
--
--   * Admin mute ("silence"): a location_admin+ can stop a member posting in a
--     channel. They still read it; the send is refused server-side.
--   * Flags: anyone in a thread can flag someone else's message. Every admin
--     who moderates that conversation is notified; the flag sits in their
--     dashboard inbox until dismissed / message removed / sender muted.
--   * @mentions: stored ON the message row (jsonb) so the notify trigger can
--     see them in the same insert — a separate table would race the trigger.
--     @person and @managers are open to everyone (so a dealer can escalate);
--     @role and @all need manager+. A mention is always delivered, even when
--     the recipient has the thread muted. Scope is the conversation's own
--     participants, which is what makes it property-specific.
-- =============================================================================

-- ----------------------------------------------------------- admin mute
alter table public.conversation_participants
  add column if not exists silenced_by uuid references public.team_members (id),
  add column if not exists silenced_at timestamptz;

create or replace function private.is_silenced(cid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_participants p
    where p.conversation_id = cid
      and p.team_member_id = private.current_team_member_id()
      and p.silenced_at is not null
  );
$$;

-- moderators may now update other people's participant rows (to silence them);
-- your own row stays yours (read receipts, mute)
drop policy if exists "conversation_participants_update" on public.conversation_participants;
create policy "conversation_participants_update" on public.conversation_participants
  for update to authenticated
  using (
    team_member_id = private.current_team_member_id()
    or private.can_moderate_conversation(conversation_id)
  )
  with check (
    team_member_id = private.current_team_member_id()
    or private.can_moderate_conversation(conversation_id)
  );

-- ------------------------------------------------------------- mentions
alter table public.messages
  add column if not exists mentions jsonb not null default '[]'::jsonb;

-- [{kind:'member'|'role'|'managers'|'all', target_id:uuid|null, label:text}]
create or replace function private.mentions_permitted(m jsonb)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(m, '[]'::jsonb) = '[]'::jsonb
      or private.is_at_least('manager')
      or not exists (
        select 1 from jsonb_array_elements(m) e
        where e->>'kind' in ('role', 'all')
      );
$$;

drop policy if exists "messages_insert" on public.messages;
create policy "messages_insert" on public.messages
  for insert to authenticated
  with check (
    sender_team_member_id = private.current_team_member_id()
    and private.is_conversation_participant(conversation_id)
    and not private.dm_blocked(conversation_id)
    and not private.is_silenced(conversation_id)
    and private.mentions_permitted(mentions)
  );

-- notify: mentioned people always hear about it; everyone else only if unmuted
create or replace function private.notify_new_message()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  conv         public.conversations%rowtype;
  sender_name  text;
  v_title      text;
  v_where      text;
  r            record;
  mentioned    uuid[];
  mention_all  boolean;
  mention_mgrs boolean;
begin
  if new.deleted_at is not null then
    return null;
  end if;

  select * into conv from public.conversations where id = new.conversation_id;
  select coalesce(preferred_name, first_name) || ' ' || last_name
    into sender_name
  from public.team_members where id = new.sender_team_member_id;

  v_where := case when conv.title is not null and conv.conversation_type <> 'direct'
                  then ' in ' || conv.title else '' end;
  v_title := case when v_where <> '' then sender_name || v_where
                  else 'New message from ' || sender_name end;

  mention_all  := exists (select 1 from jsonb_array_elements(new.mentions) e where e->>'kind' = 'all');
  mention_mgrs := exists (select 1 from jsonb_array_elements(new.mentions) e where e->>'kind' = 'managers');

  select coalesce(array_agg(distinct cp.team_member_id), '{}') into mentioned
  from public.conversation_participants cp
  where cp.conversation_id = new.conversation_id
    and cp.team_member_id <> new.sender_team_member_id
    and (
      mention_all
      or (mention_mgrs and private.member_rank(cp.team_member_id) >= private.permission_rank('manager'))
      or exists (
        select 1 from jsonb_array_elements(new.mentions) e
        where e->>'kind' = 'member' and (e->>'target_id')::uuid = cp.team_member_id)
      or exists (
        select 1 from jsonb_array_elements(new.mentions) e
        join public.team_member_roles tmr on tmr.role_id = (e->>'target_id')::uuid
        where e->>'kind' = 'role' and tmr.team_member_id = cp.team_member_id)
    );

  for r in
    select cp.team_member_id, cp.muted
    from public.conversation_participants cp
    where cp.conversation_id = new.conversation_id
      and cp.team_member_id <> new.sender_team_member_id
  loop
    if r.team_member_id = any(mentioned) then
      perform private.notify(
        r.team_member_id, 'message_mentioned',
        sender_name || ' mentioned you' || v_where,
        left(new.body, 120), 'conversation', new.conversation_id);
    elsif not r.muted then
      -- one unread alert per conversation per person
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
    end if;
  end loop;

  return null;
end;
$$;

-- ---------------------------------------------------------------- flags
create type public.message_flag_status as enum ('open', 'dismissed', 'removed', 'muted');

create table public.message_flags (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  flagged_by      uuid not null references public.team_members (id),
  reason          text,
  status          public.message_flag_status not null default 'open',
  reviewed_by     uuid references public.team_members (id),
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index message_flags_open_idx    on public.message_flags (status, created_at desc);
create index message_flags_message_idx on public.message_flags (message_id);
-- one live flag per person per message
create unique index message_flags_once on public.message_flags (message_id, flagged_by) where status = 'open';

alter table public.message_flags enable row level security;

-- anyone in the thread can flag someone ELSE's message
create policy "message_flags_insert" on public.message_flags
  for insert to authenticated
  with check (
    flagged_by = private.current_team_member_id()
    and private.is_conversation_participant(conversation_id)
    and exists (
      select 1 from public.messages m
      where m.id = message_id
        and m.conversation_id = message_flags.conversation_id
        and m.sender_team_member_id <> private.current_team_member_id()
    )
  );
create policy "message_flags_select" on public.message_flags
  for select to authenticated
  using (
    flagged_by = private.current_team_member_id()
    or private.can_moderate_conversation(conversation_id)
  );
create policy "message_flags_update" on public.message_flags
  for update to authenticated
  using (private.can_moderate_conversation(conversation_id))
  with check (private.can_moderate_conversation(conversation_id));

create trigger audit after insert or update on public.message_flags
  for each row execute function private.write_audit_log();

-- every admin who moderates this conversation (mirrors can_moderate_conversation,
-- but enumerated, for a trigger that has no "current user")
create or replace function private.conversation_moderator_ids(cid uuid)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select tm.id
  from public.team_members tm
  where tm.status = 'active'
    and (
      private.member_rank(tm.id) >= private.permission_rank('corporate_admin')
      or (
        private.member_rank(tm.id) >= private.permission_rank('location_admin')
        and (
          exists (
            select 1 from public.conversations c
            join private.member_location_ids(tm.id) ml on ml.location_id = c.location_id
            where c.id = cid
          )
          or exists (
            select 1
            from public.conversation_participants p
            cross join lateral private.member_location_ids(p.team_member_id) pl
            join private.member_location_ids(tm.id) ml on ml.location_id = pl.location_id
            where p.conversation_id = cid
          )
        )
      )
    );
$$;

create or replace function private.notify_message_flag()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_body    text;
  v_sender  text;
  v_flagger text;
  m         uuid;
begin
  select left(msg.body, 100), coalesce(s.preferred_name, s.first_name) || ' ' || s.last_name
    into v_body, v_sender
  from public.messages msg
  join public.team_members s on s.id = msg.sender_team_member_id
  where msg.id = new.message_id;

  select coalesce(preferred_name, first_name) || ' ' || last_name into v_flagger
  from public.team_members where id = new.flagged_by;

  for m in select * from private.conversation_moderator_ids(new.conversation_id) loop
    if m <> new.flagged_by then
      perform private.notify(
        m, 'message_flagged', 'Message flagged for review',
        v_flagger || ' flagged a message from ' || v_sender || ': ' || v_body,
        'conversation', new.conversation_id);
    end if;
  end loop;
  return null;
end;
$$;

create trigger notify_message_flag after insert on public.message_flags
  for each row execute function private.notify_message_flag();
