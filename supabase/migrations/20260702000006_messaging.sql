-- =============================================================================
-- Domain 6: Messaging (new feature — Discord-style)
--
-- Conversation types:
--   direct     — DMs; any team member, limited to people at their locations
--   group      — custom groups; manager+ creates and manages membership
--   role_group — tied to a role (optionally location-scoped); membership is
--                auto-synced from role/location assignments, never manual;
--                members can mute them but cannot leave them
--
-- Moderation: location_admin+ can see and edit all conversations touching
-- their locations; corporate_admin+ everywhere.
-- Blocking: any team member can block another, except location_admin+ and
-- except manager+ at one of the blocker's own locations (you can't block your
-- own manager); a block shuts down DMs between the two, both ways.
-- Messages soft-delete only (deleted_at); threads are never deleted.
-- Per Victor: no audit trigger on messaging tables.
-- =============================================================================

create type public.conversation_type as enum ('direct', 'group', 'role_group');

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table public.conversations (
  id                uuid primary key default gen_random_uuid(),
  created_by        uuid references public.team_members (id),
  conversation_type public.conversation_type not null default 'direct',
  title             text, -- optional; DMs usually render the other person's name
  location_id       uuid references public.locations (id), -- scopes role_groups; optional context otherwise
  role_id           uuid references public.roles (id),
  last_message_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (
    (conversation_type = 'role_group' and role_id is not null)
    or (conversation_type <> 'role_group' and role_id is null)
  )
);

create index conversations_role_idx
  on public.conversations (role_id) where conversation_type = 'role_group';

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  team_member_id  uuid not null references public.team_members (id) on delete cascade,
  last_read_at    timestamptz, -- drives unread badges
  muted           boolean not null default false, -- silences notifications; any conversation can be muted
  created_at      timestamptz not null default now(),
  primary key (conversation_id, team_member_id)
);

create index conversation_participants_member_idx
  on public.conversation_participants (team_member_id);

create table public.messages (
  id                    uuid primary key default gen_random_uuid(),
  conversation_id       uuid not null references public.conversations (id) on delete cascade,
  sender_team_member_id uuid not null references public.team_members (id),
  body                  text not null check (length(trim(body)) > 0),
  deleted_at            timestamptz, -- soft delete ("message removed"); no hard deletes
  deleted_by            uuid references public.team_members (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
  -- an edit is visible as updated_at > created_at (room for attachments later)
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);

create table public.member_blocks (
  blocker_team_member_id uuid not null references public.team_members (id) on delete cascade,
  blocked_team_member_id uuid not null references public.team_members (id) on delete cascade,
  created_at             timestamptz not null default now(),
  primary key (blocker_team_member_id, blocked_team_member_id),
  check (blocker_team_member_id <> blocked_team_member_id)
);

create index member_blocks_blocked_idx on public.member_blocks (blocked_team_member_id);

-- -----------------------------------------------------------------------------
-- Helpers (definer, so cross-referencing policies can't recurse)
-- -----------------------------------------------------------------------------

create or replace function private.is_conversation_participant(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_participants p
    where p.conversation_id = cid
      and p.team_member_id = private.current_team_member_id()
  );
$$;

create or replace function private.created_conversation(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversations c
    where c.id = cid
      and c.created_by = private.current_team_member_id()
  );
$$;

create or replace function private.conversation_type_of(cid uuid)
returns public.conversation_type
language sql
stable
security definer
set search_path = ''
as $$
  select conversation_type from public.conversations where id = cid;
$$;

create or replace function private.member_rank(member uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.permission_rank(permission_level)
     from public.team_members
     where id = member),
    0
  );
$$;

create or replace function private.blocked_between(member_a uuid, member_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.member_blocks b
    where (b.blocker_team_member_id = member_a and b.blocked_team_member_id = member_b)
       or (b.blocker_team_member_id = member_b and b.blocked_team_member_id = member_a)
  );
$$;

-- a block (either direction) between me and the other party kills the DM
create or replace function private.dm_blocked(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.conversation_type_of(cid) = 'direct'
     and exists (
       select 1
       from public.conversation_participants p
       where p.conversation_id = cid
         and p.team_member_id <> private.current_team_member_id()
         and private.blocked_between(p.team_member_id, private.current_team_member_id())
     );
$$;

-- location_admin+ moderates conversations touching their locations
-- (the conversation's own location, or any participant they share one with);
-- corporate_admin+ moderates everything
create or replace function private.can_moderate_conversation(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_at_least('corporate_admin')
      or (
        private.is_at_least('location_admin')
        and (
          exists (
            select 1
            from public.conversations c
            where c.id = cid
              and c.location_id is not null
              and private.has_location_access(c.location_id)
          )
          or exists (
            select 1
            from public.conversation_participants p
            where p.conversation_id = cid
              and private.shares_location_with(p.team_member_id)
          )
        )
      );
$$;

-- -----------------------------------------------------------------------------
-- Role-group auto-membership: participants of a role_group conversation are
-- derived from role + location assignments and kept in sync by triggers.
-- -----------------------------------------------------------------------------

create or replace function private.sync_member_role_groups(member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- add to role groups the member now qualifies for
  insert into public.conversation_participants (conversation_id, team_member_id)
  select c.id, member
  from public.conversations c
  where c.conversation_type = 'role_group'
    and exists (
      select 1 from public.team_member_roles r
      where r.team_member_id = member and r.role_id = c.role_id
    )
    and (
      c.location_id is null
      or exists (
        select 1 from private.member_location_ids(member) l
        where l.location_id = c.location_id
      )
    )
  on conflict do nothing;

  -- drop from role groups the member no longer qualifies for
  delete from public.conversation_participants p
  using public.conversations c
  where c.id = p.conversation_id
    and p.team_member_id = member
    and c.conversation_type = 'role_group'
    and (
      not exists (
        select 1 from public.team_member_roles r
        where r.team_member_id = member and r.role_id = c.role_id
      )
      or (
        c.location_id is not null
        and not exists (
          select 1 from private.member_location_ids(member) l
          where l.location_id = c.location_id
        )
      )
    );
end;
$$;

-- populate a role_group when it's created
create or replace function private.populate_role_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.conversation_type = 'role_group' then
    insert into public.conversation_participants (conversation_id, team_member_id)
    select new.id, r.team_member_id
    from public.team_member_roles r
    where r.role_id = new.role_id
      and (
        new.location_id is null
        or exists (
          select 1 from private.member_location_ids(r.team_member_id) l
          where l.location_id = new.location_id
        )
      )
    on conflict do nothing;
  end if;
  return null;
end;
$$;

create trigger populate_role_group after insert on public.conversations
  for each row execute function private.populate_role_group();

-- re-sync when a member's roles or locations change
create or replace function private.on_member_qualification_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_member_role_groups(coalesce(new.team_member_id, old.team_member_id));
  return null;
end;
$$;

create trigger sync_role_groups after insert or delete on public.team_member_roles
  for each row execute function private.on_member_qualification_change();
create trigger sync_role_groups after insert or delete on public.team_member_locations
  for each row execute function private.on_member_qualification_change();

create or replace function private.on_member_home_location_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_member_role_groups(new.id);
  return null;
end;
$$;

create trigger sync_role_groups after update of home_location_id on public.team_members
  for each row execute function private.on_member_home_location_change();

-- -----------------------------------------------------------------------------
-- Housekeeping triggers
-- -----------------------------------------------------------------------------

create or replace function private.set_created_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_by := coalesce(new.created_by, private.current_team_member_id());
  return new;
end;
$$;

create trigger set_created_by before insert on public.conversations
  for each row execute function private.set_created_by();

create trigger set_updated_at before update on public.conversations
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.messages
  for each row execute function private.set_updated_at();

-- keep conversations.last_message_at current (definer: senders don't need
-- update rights on the conversation row itself)
create or replace function private.bump_conversation_last_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
  set last_message_at = new.created_at
  where id = new.conversation_id;
  return null;
end;
$$;

create trigger bump_last_message after insert on public.messages
  for each row execute function private.bump_conversation_last_message();

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- -----------------------------------------------------------------------------

alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.member_blocks enable row level security;

-- conversations: participants and the creator see them; location_admin+
-- moderates in scope. Any member starts a DM; manager+ creates groups and
-- role groups. No delete — threads persist.
create policy "conversations_select" on public.conversations
  for select to authenticated
  using (
    private.is_conversation_participant(id)
    or created_by = private.current_team_member_id()
    or private.can_moderate_conversation(id)
  );
create policy "conversations_insert" on public.conversations
  for insert to authenticated
  with check (
    created_by = private.current_team_member_id()
    and (
      conversation_type = 'direct'
      or (
        conversation_type in ('group', 'role_group')
        and (select private.is_at_least('manager'))
      )
    )
  );
create policy "conversations_update" on public.conversations
  for update to authenticated
  using (
    created_by = private.current_team_member_id()
    or (
      (select private.is_at_least('manager'))
      and private.is_conversation_participant(id)
    )
    or private.can_moderate_conversation(id)
  )
  with check (
    created_by = private.current_team_member_id()
    or (
      (select private.is_at_least('manager'))
      and private.is_conversation_participant(id)
    )
    or private.can_moderate_conversation(id)
  );

-- participants:
--   * a DM's creator assembles it: themselves + people at their own locations,
--     unless a block exists between the two
--   * custom groups: only manager+ (in the thread or its creator) adds people,
--     limited to people at their locations
--   * role groups: membership is auto-synced, no manual adds (admins excepted)
--   * your own row is yours to update (read receipts, mute) or delete (leave a
--     DM or group — role groups can be muted but not left); managers+ can
--     remove people from groups; admins moderate anywhere
create policy "conversation_participants_select" on public.conversation_participants
  for select to authenticated
  using (
    team_member_id = private.current_team_member_id()
    or private.is_conversation_participant(conversation_id)
    or private.can_moderate_conversation(conversation_id)
  );
create policy "conversation_participants_insert" on public.conversation_participants
  for insert to authenticated
  with check (
    private.can_moderate_conversation(conversation_id)
    or (
      private.conversation_type_of(conversation_id) = 'direct'
      and private.created_conversation(conversation_id)
      and (
        team_member_id = private.current_team_member_id()
        or (
          private.shares_location_with(team_member_id)
          and not private.blocked_between(private.current_team_member_id(), team_member_id)
        )
      )
    )
    or (
      private.conversation_type_of(conversation_id) = 'group'
      and (select private.is_at_least('manager'))
      and (
        private.created_conversation(conversation_id)
        or private.is_conversation_participant(conversation_id)
      )
      and (
        team_member_id = private.current_team_member_id()
        or private.shares_location_with(team_member_id)
      )
    )
  );
create policy "conversation_participants_update" on public.conversation_participants
  for update to authenticated
  using (team_member_id = private.current_team_member_id())
  with check (team_member_id = private.current_team_member_id());
create policy "conversation_participants_delete" on public.conversation_participants
  for delete to authenticated
  using (
    (
      team_member_id = private.current_team_member_id()
      and private.conversation_type_of(conversation_id) <> 'role_group'
    )
    or private.can_moderate_conversation(conversation_id)
    or (
      private.conversation_type_of(conversation_id) = 'group'
      and (select private.is_at_least('manager'))
      and (
        private.created_conversation(conversation_id)
        or private.is_conversation_participant(conversation_id)
      )
    )
  );

-- messages: participants read; you send only as yourself, into threads you're
-- in, and not into a DM where a block exists. Senders edit their own;
-- location_admin+ edits anything in scope. Delete is soft (deleted_at via
-- update) — no hard-delete policy.
create policy "messages_select" on public.messages
  for select to authenticated
  using (
    private.is_conversation_participant(conversation_id)
    or private.can_moderate_conversation(conversation_id)
  );
create policy "messages_insert" on public.messages
  for insert to authenticated
  with check (
    sender_team_member_id = private.current_team_member_id()
    and private.is_conversation_participant(conversation_id)
    and not private.dm_blocked(conversation_id)
  );
create policy "messages_update" on public.messages
  for update to authenticated
  using (
    sender_team_member_id = private.current_team_member_id()
    or private.can_moderate_conversation(conversation_id)
  )
  with check (
    sender_team_member_id = private.current_team_member_id()
    or private.can_moderate_conversation(conversation_id)
  );

-- blocks: your block list is yours alone (super_admin can inspect).
-- Unblockable: location_admin+ anywhere, and manager+ at one of the blocker's
-- own locations (you can't block your own manager)
create policy "member_blocks_select" on public.member_blocks
  for select to authenticated
  using (
    blocker_team_member_id = private.current_team_member_id()
    or (select private.is_at_least('super_admin'))
  );
create policy "member_blocks_insert" on public.member_blocks
  for insert to authenticated
  with check (
    blocker_team_member_id = private.current_team_member_id()
    and private.member_rank(blocked_team_member_id) < private.permission_rank('location_admin')
    and not (
      private.member_rank(blocked_team_member_id) >= private.permission_rank('manager')
      and private.shares_location_with(blocked_team_member_id)
    )
  );
create policy "member_blocks_delete" on public.member_blocks
  for delete to authenticated
  using (blocker_team_member_id = private.current_team_member_id());

-- live chat: stream new messages over Supabase Realtime
alter publication supabase_realtime add table public.messages;
