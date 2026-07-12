-- =============================================================================
-- Announcements with read-confirmation
--
-- A one-to-many broadcast, distinct from conversations: a sender posts to an
-- audience (everyone / a location / a role) and can require each recipient to
-- acknowledge ("X of N acknowledged").
--
-- Recipients are SNAPSHOTTED at publish time into announcement_recipients, so
-- the denominator N is stable even as staff join or leave afterward, and each
-- recipient can find their own announcements through a simple RLS check.
--
-- Permissions:
--   * manager+ may post to a location or a role they have access to
--   * corporate_admin+ may post to everyone
--   * location_admin+ moderates (reads/edits) announcements touching their
--     locations; corporate_admin+ everywhere
-- =============================================================================

create type public.announcement_audience as enum ('all', 'location', 'role');

create table public.announcements (
  id                      uuid primary key default gen_random_uuid(),
  created_by              uuid references public.team_members (id),
  title                   text not null check (length(trim(title)) > 0),
  body                    text not null check (length(trim(body)) > 0),
  audience_type           public.announcement_audience not null default 'all',
  location_id             uuid references public.locations (id),
  role_id                 uuid references public.roles (id),
  requires_acknowledgment boolean not null default false,
  published_at            timestamptz, -- null = draft; set by publish_announcement()
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (audience_type <> 'location' or location_id is not null),
  check (audience_type <> 'role' or role_id is not null)
);

create index announcements_created_by_idx on public.announcements (created_by);
create index announcements_published_idx on public.announcements (published_at);

create table public.announcement_recipients (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  team_member_id  uuid not null references public.team_members (id) on delete cascade,
  acknowledged_at timestamptz,
  created_at      timestamptz not null default now(),
  primary key (announcement_id, team_member_id)
);

create index announcement_recipients_member_idx on public.announcement_recipients (team_member_id);

-- -----------------------------------------------------------------------------
-- Helpers (definer, so policies can reference across tables without recursion)
-- -----------------------------------------------------------------------------

create or replace function private.owns_announcement(aid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.announcements a
    where a.id = aid and a.created_by = private.current_team_member_id()
  );
$$;

create or replace function private.is_announcement_recipient(aid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.announcement_recipients r
    where r.announcement_id = aid
      and r.team_member_id = private.current_team_member_id()
  );
$$;

-- location_admin+ moderates announcements touching their locations
-- (the announcement's own location, or any recipient they share one with);
-- corporate_admin+ moderates everything
create or replace function private.can_moderate_announcement(aid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_at_least('corporate_admin')
      or (
        private.is_at_least('location_admin')
        and (
          exists (
            select 1 from public.announcements a
            where a.id = aid
              and a.location_id is not null
              and private.has_location_access(a.location_id)
          )
          or exists (
            select 1 from public.announcement_recipients r
            where r.announcement_id = aid
              and private.shares_location_with(r.team_member_id)
          )
        )
      );
$$;

-- -----------------------------------------------------------------------------
-- Publish: snapshot the recipient set and stamp published_at. Enforces the
-- audience-permission rules server-side (definer).
-- -----------------------------------------------------------------------------

create or replace function public.publish_announcement(aid uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a public.announcements;
begin
  select * into a from public.announcements where id = aid;
  if not found then
    raise exception 'announcement not found';
  end if;
  if a.created_by <> private.current_team_member_id()
     and not private.can_moderate_announcement(aid) then
    raise exception 'not allowed to publish this announcement';
  end if;

  -- audience-specific permission + recipient set
  if a.audience_type = 'all' then
    if not private.is_at_least('corporate_admin') then
      raise exception 'only corporate admins may post to everyone';
    end if;
    insert into public.announcement_recipients (announcement_id, team_member_id)
    select a.id, tm.id from public.team_members tm where tm.status = 'active'
    on conflict do nothing;

  elsif a.audience_type = 'location' then
    if not (private.is_at_least('manager') and private.has_location_access(a.location_id)) then
      raise exception 'not allowed to post to this location';
    end if;
    insert into public.announcement_recipients (announcement_id, team_member_id)
    select a.id, tm.id
    from public.team_members tm
    where tm.status = 'active'
      and exists (
        select 1 from private.member_location_ids(tm.id) l
        where l.location_id = a.location_id
      )
    on conflict do nothing;

  elsif a.audience_type = 'role' then
    if not private.is_at_least('manager') then
      raise exception 'not allowed to post to this role';
    end if;
    insert into public.announcement_recipients (announcement_id, team_member_id)
    select a.id, r.team_member_id
    from public.team_member_roles r
    join public.team_members tm on tm.id = r.team_member_id
    where r.role_id = a.role_id
      and tm.status = 'active'
      -- managers below corporate_admin only reach recipients at their locations
      and (
        private.is_at_least('corporate_admin')
        or private.shares_location_with(r.team_member_id)
      )
    on conflict do nothing;
  end if;

  update public.announcements
  set published_at = coalesce(published_at, now())
  where id = aid;
end;
$$;

grant execute on function public.publish_announcement(uuid) to authenticated;

-- Acknowledgment roster for a sender/moderator: names + ack status, so the UI
-- can show "X of N acknowledged" and who's outstanding. Definer, because a
-- manager can't necessarily read every recipient's team_members row.
create or replace function public.announcement_ack_status(aid uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case
    when not (private.owns_announcement(aid) or private.can_moderate_announcement(aid))
      then '[]'::jsonb
    else coalesce(jsonb_agg(jsonb_build_object(
      'team_member_id', r.team_member_id,
      'name', coalesce(nullif(tm.preferred_name, ''), tm.first_name) || ' ' || tm.last_name,
      'acknowledged_at', r.acknowledged_at
    ) order by r.acknowledged_at nulls last,
      coalesce(nullif(tm.preferred_name, ''), tm.first_name)), '[]'::jsonb)
  end
  from public.announcement_recipients r
  join public.team_members tm on tm.id = r.team_member_id
  where r.announcement_id = aid;
$$;

grant execute on function public.announcement_ack_status(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Housekeeping
-- -----------------------------------------------------------------------------

create trigger set_created_by before insert on public.announcements
  for each row execute function private.set_created_by();
create trigger set_updated_at before update on public.announcements
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- -----------------------------------------------------------------------------

alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;

-- announcements: recipients see published ones; creators see their own
-- (incl. drafts); moderators see in-scope. manager+ creates; creator/moderator
-- edits. No delete from the client — kept for the record.
create policy "announcements_select" on public.announcements
  for select to authenticated
  using (
    (published_at is not null and private.is_announcement_recipient(id))
    or created_by = private.current_team_member_id()
    or private.can_moderate_announcement(id)
  );
create policy "announcements_insert" on public.announcements
  for insert to authenticated
  with check (
    created_by = private.current_team_member_id()
    and (select private.is_at_least('manager'))
  );
create policy "announcements_update" on public.announcements
  for update to authenticated
  using (
    created_by = private.current_team_member_id()
    or private.can_moderate_announcement(id)
  )
  with check (
    created_by = private.current_team_member_id()
    or private.can_moderate_announcement(id)
  );

-- recipients: you see your own row (to read + acknowledge); the announcement's
-- owner and moderators see all rows (to tally "X of N"). You may update only
-- your own row (acknowledgment). Inserts happen through publish_announcement().
create policy "announcement_recipients_select" on public.announcement_recipients
  for select to authenticated
  using (
    team_member_id = private.current_team_member_id()
    or private.owns_announcement(announcement_id)
    or private.can_moderate_announcement(announcement_id)
  );
create policy "announcement_recipients_update" on public.announcement_recipients
  for update to authenticated
  using (team_member_id = private.current_team_member_id())
  with check (team_member_id = private.current_team_member_id());
