-- =============================================================================
-- Messages list housekeeping: pin, hide ("delete for me"), delete group
--
--   * pinned     — per person; pinned conversations float to the top
--   * hidden_at  — per person; "Delete conversation" hides the thread for me.
--                  It comes back automatically if someone posts in it again
--                  (same behaviour as every chat app), so nothing is lost.
--   * archived   — a group deleted for everyone by its creator or a moderating
--                  admin. Archived threads vanish from every list and refuse
--                  new messages. (Leaving a group was already possible: a
--                  member deletes their own participant row.)
-- =============================================================================

alter table public.conversation_participants
  add column if not exists pinned    boolean not null default false,
  add column if not exists hidden_at timestamptz;

alter table public.conversations
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.team_members (id);

create or replace function private.conversation_archived(cid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.conversations where id = cid and archived_at is not null);
$$;

-- nobody posts into a deleted group
drop policy if exists "messages_insert" on public.messages;
create policy "messages_insert" on public.messages
  for insert to authenticated
  with check (
    sender_team_member_id = private.current_team_member_id()
    and private.is_conversation_participant(conversation_id)
    and not private.conversation_archived(conversation_id)
    and not private.dm_blocked(conversation_id)
    and not private.is_messaging_muted()
    and private.mentions_permitted(mentions)
  );

-- the nav bubble ignores hidden and archived threads
create or replace function public.unread_message_count()
returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::integer
  from public.conversation_participants cp
  join public.conversations c on c.id = cp.conversation_id
  where cp.team_member_id = private.current_team_member_id()
    and not cp.muted
    and c.archived_at is null
    and c.last_message_at is not null
    and c.last_message_at > coalesce(cp.last_read_at, 'epoch'::timestamptz)
    and (cp.hidden_at is null or c.last_message_at > cp.hidden_at)
    and exists (
      select 1 from public.messages m
      where m.conversation_id = c.id
        and m.sender_team_member_id <> cp.team_member_id
        and m.deleted_at is null
        and m.created_at > coalesce(cp.last_read_at, 'epoch'::timestamptz)
    );
$$;
