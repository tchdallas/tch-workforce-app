-- =============================================================================
-- Policies & Procedures
--
-- A living rulebook. Each policy is scoped to the ROLES it applies to and the
-- CLUBS it applies at (both required) — a cashier variance policy reaches
-- cashiers at the clubs that adopted it, and never shows up for a bartender.
--
-- Three things hang off a policy:
--   * documents  — the actual signed/printed policy, in a private bucket
--   * updates    — addendums, clarifications, examples, reminders. Managers push
--                  these as the rule evolves; each can require acknowledgment.
--   * comments   — a discussion thread. Anyone who can see the policy can ask a
--                  question in it, so the answer lives next to the rule instead
--                  of in someone's memory of a pre-shift meeting.
--
-- Acknowledgment mirrors announcements: recipients are SNAPSHOTTED at publish
-- time so "X of N acknowledged" has a stable denominator even as staff join or
-- leave. Both a policy and an individual update may require it, author's choice.
--
-- Permissions:
--   * manager+ authors and publishes, limited to clubs they have access to
--   * location_admin+ moderates policies at their clubs; corporate_admin+ all
--   * everyone in the audience reads and comments
-- =============================================================================

create type public.policy_status as enum ('draft', 'published', 'archived');

-- What kind of follow-up a manager is posting. Purely descriptive — it drives
-- the label and icon in the UI, not permissions.
create type public.policy_update_kind as enum (
  'update', 'addendum', 'clarification', 'example', 'reminder'
);

-- Categories are a managed list, not free text on each policy: typed strings
-- drift ("Game Procedures" / "Game procedure" / "Games") and silently split the
-- list into near-duplicate headings. Managers add one from inside the editor;
-- renaming it here renames it everywhere at once.
create table public.policy_categories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) > 0),
  display_order integer not null default 0,
  status        public.record_status not null default 'active',
  created_by    uuid references public.team_members (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- case-insensitive uniqueness, so "Game Procedures" and "game procedures"
-- can't both exist and re-create the drift this table exists to prevent
create unique index policy_categories_name_key on public.policy_categories (lower(trim(name)));

create table public.policies (
  id                      uuid primary key default gen_random_uuid(),
  created_by              uuid references public.team_members (id),
  title                   text not null check (length(trim(title)) > 0),
  summary                 text, -- one-liner for the list view
  body                    text, -- the procedure itself; optional when a document carries it
  status                  public.policy_status not null default 'draft',
  requires_acknowledgment boolean not null default false,
  published_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index policies_status_idx on public.policies (status, published_at desc);
create index policies_created_by_idx on public.policies (created_by);
-- A policy can file under several categories — a straddle rule is plausibly both
-- "Game Procedures" and "New Dealer Training", and it should surface under
-- either heading rather than forcing a pick. No categories = Uncategorised.
create table public.policy_category_links (
  policy_id   uuid not null references public.policies (id) on delete cascade,
  category_id uuid not null references public.policy_categories (id) on delete cascade,
  primary key (policy_id, category_id)
);
create index policy_category_links_category_idx on public.policy_category_links (category_id);

-- Audience. Both dimensions are required at publish time (enforced in
-- publish_policy, not as a table constraint, so a draft can be built up
-- incrementally while the author is still writing it).
create table public.policy_roles (
  policy_id uuid not null references public.policies (id) on delete cascade,
  role_id   uuid not null references public.roles (id) on delete cascade,
  primary key (policy_id, role_id)
);
create index policy_roles_role_idx on public.policy_roles (role_id);

create table public.policy_locations (
  policy_id   uuid not null references public.policies (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  primary key (policy_id, location_id)
);
create index policy_locations_location_idx on public.policy_locations (location_id);

-- The uploaded policy document(s). Files live in the private 'policy-documents'
-- bucket under <policy_id>/<filename>, which is what the storage policy at the
-- bottom keys off to decide who may download.
create table public.policy_documents (
  id           uuid primary key default gen_random_uuid(),
  policy_id    uuid not null references public.policies (id) on delete cascade,
  storage_path text not null,
  file_name    text not null,
  content_type text,
  file_size    bigint,
  uploaded_by  uuid references public.team_members (id),
  created_at   timestamptz not null default now()
);
create index policy_documents_policy_idx on public.policy_documents (policy_id);

create table public.policy_updates (
  id                      uuid primary key default gen_random_uuid(),
  policy_id               uuid not null references public.policies (id) on delete cascade,
  created_by              uuid references public.team_members (id),
  kind                    public.policy_update_kind not null default 'update',
  title                   text not null check (length(trim(title)) > 0),
  body                    text not null check (length(trim(body)) > 0),
  requires_acknowledgment boolean not null default false,
  published_at            timestamptz, -- null = draft
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index policy_updates_policy_idx on public.policy_updates (policy_id, published_at desc);

-- Discussion thread. One level of nesting (a reply to a question) — parent_id
-- pointing at another reply is allowed but the UI renders it flat under the
-- top-level question, which keeps a fast-moving floor thread readable.
create table public.policy_comments (
  id         uuid primary key default gen_random_uuid(),
  policy_id  uuid not null references public.policies (id) on delete cascade,
  parent_id  uuid references public.policy_comments (id) on delete cascade,
  created_by uuid references public.team_members (id),
  body       text not null check (length(trim(body)) > 0),
  pinned     boolean not null default false,
  deleted_at timestamptz, -- soft delete; never hard-delete the record
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index policy_comments_policy_idx on public.policy_comments (policy_id, created_at);

-- Acknowledgment rosters, snapshotted at publish (see header note).
create table public.policy_recipients (
  policy_id       uuid not null references public.policies (id) on delete cascade,
  team_member_id  uuid not null references public.team_members (id) on delete cascade,
  acknowledged_at timestamptz,
  created_at      timestamptz not null default now(),
  primary key (policy_id, team_member_id)
);
create index policy_recipients_member_idx on public.policy_recipients (team_member_id);

create table public.policy_update_recipients (
  policy_update_id uuid not null references public.policy_updates (id) on delete cascade,
  team_member_id   uuid not null references public.team_members (id) on delete cascade,
  acknowledged_at  timestamptz,
  created_at       timestamptz not null default now(),
  primary key (policy_update_id, team_member_id)
);
create index policy_update_recipients_member_idx on public.policy_update_recipients (team_member_id);

-- -----------------------------------------------------------------------------
-- Helpers (definer, so policies can reference across tables without recursion)
-- -----------------------------------------------------------------------------

-- Audience test: you must hold one of the policy's roles AND work at one of its
-- clubs. AND, not OR — "cashiers at Dallas" must not reach Austin cashiers or
-- Dallas bartenders.
create or replace function private.in_policy_audience(pid uuid, member uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
      select 1
      from public.policy_roles pr
      join public.team_member_roles tmr on tmr.role_id = pr.role_id
      where pr.policy_id = pid and tmr.team_member_id = member
    )
    and exists (
      select 1
      from public.policy_locations pl
      join private.member_location_ids(member) ml on ml.location_id = pl.location_id
      where pl.policy_id = pid
    );
$$;

-- location_admin+ moderates policies that touch their clubs; corporate_admin+ all
create or replace function private.can_moderate_policy(pid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_at_least('corporate_admin')
      or (
        private.is_at_least('location_admin')
        and exists (
          select 1 from public.policy_locations pl
          where pl.policy_id = pid and private.has_location_access(pl.location_id)
        )
      );
$$;

-- Who may read a policy: its author, a moderator, or — once published — anyone
-- in the audience. Managers at a club the policy covers also read it even when
-- they don't personally hold the role: they supervise the people who do and
-- have to answer questions about it.
create or replace function private.can_see_policy(pid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
        select 1 from public.policies p
        where p.id = pid and p.created_by = private.current_team_member_id()
      )
      or private.can_moderate_policy(pid)
      or (
        exists (select 1 from public.policies p where p.id = pid and p.status = 'published')
        and (
          private.in_policy_audience(pid, private.current_team_member_id())
          or (
            private.is_at_least('manager')
            and exists (
              select 1 from public.policy_locations pl
              where pl.policy_id = pid and private.has_location_access(pl.location_id)
            )
          )
        )
      );
$$;

-- Every club on the policy must be one this manager actually runs, or they
-- could publish rules into a room they have nothing to do with.
create or replace function private.covers_only_my_locations(pid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_at_least('corporate_admin')
      or not exists (
        select 1 from public.policy_locations pl
        where pl.policy_id = pid and not private.has_location_access(pl.location_id)
      );
$$;

-- -----------------------------------------------------------------------------
-- Publish
-- -----------------------------------------------------------------------------

-- Snapshot the audience and stamp published_at. Recipients are only recorded
-- when acknowledgment is actually required — otherwise a policy read by 1,000
-- people would write 1,000 rows nobody ever looks at.
create or replace function public.publish_policy(pid uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.policies;
begin
  select * into p from public.policies where id = pid;
  if not found then
    raise exception 'policy not found';
  end if;
  if not private.is_at_least('manager') then
    raise exception 'only managers and above may publish policies';
  end if;
  if p.created_by <> private.current_team_member_id()
     and not private.can_moderate_policy(pid) then
    raise exception 'not allowed to publish this policy';
  end if;
  if not exists (select 1 from public.policy_roles where policy_id = pid) then
    raise exception 'choose at least one role this policy applies to';
  end if;
  if not exists (select 1 from public.policy_locations where policy_id = pid) then
    raise exception 'choose at least one club this policy applies at';
  end if;
  if not private.covers_only_my_locations(pid) then
    raise exception 'not allowed to publish to a club you do not manage';
  end if;

  update public.policies
  set status = 'published', published_at = coalesce(published_at, now())
  where id = pid;

  if p.requires_acknowledgment then
    insert into public.policy_recipients (policy_id, team_member_id)
    select pid, tm.id
    from public.team_members tm
    where tm.status = 'active'
      and private.in_policy_audience(pid, tm.id)
    on conflict do nothing;

    perform private.notify(
      r.team_member_id, 'policy_published', 'New policy to review',
      p.title, 'Policy', pid
    )
    from public.policy_recipients r
    where r.policy_id = pid and r.acknowledged_at is null;
  end if;
end;
$$;

grant execute on function public.publish_policy(uuid) to authenticated;

-- Publish an update/addendum. Same audience as the parent policy, re-snapshotted
-- at this moment so someone hired since the policy went out still gets the change.
create or replace function public.publish_policy_update(uid uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  u public.policy_updates;
  p public.policies;
begin
  select * into u from public.policy_updates where id = uid;
  if not found then
    raise exception 'update not found';
  end if;
  select * into p from public.policies where id = u.policy_id;

  if not private.is_at_least('manager') then
    raise exception 'only managers and above may publish policy updates';
  end if;
  if u.created_by <> private.current_team_member_id()
     and not private.can_moderate_policy(u.policy_id) then
    raise exception 'not allowed to publish this update';
  end if;
  if not private.covers_only_my_locations(u.policy_id) then
    raise exception 'not allowed to publish to a club you do not manage';
  end if;
  if p.status <> 'published' then
    raise exception 'publish the policy itself before posting updates to it';
  end if;

  update public.policy_updates
  set published_at = coalesce(published_at, now())
  where id = uid;

  if u.requires_acknowledgment then
    insert into public.policy_update_recipients (policy_update_id, team_member_id)
    select uid, tm.id
    from public.team_members tm
    where tm.status = 'active'
      and private.in_policy_audience(u.policy_id, tm.id)
    on conflict do nothing;
  end if;

  -- notify the audience either way: the point of an update is that people learn
  -- about it without having to re-read the policy hoping something changed
  perform private.notify(
    tm.id, 'policy_updated',
    case u.kind
      when 'addendum'      then 'Policy addendum'
      when 'clarification' then 'Policy clarification'
      when 'example'       then 'Policy example'
      when 'reminder'      then 'Policy reminder'
      else 'Policy updated'
    end,
    p.title || ' — ' || u.title,
    'Policy', u.policy_id
  )
  from public.team_members tm
  where tm.status = 'active'
    and private.in_policy_audience(u.policy_id, tm.id);
end;
$$;

grant execute on function public.publish_policy_update(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Acknowledgment reporting (definer: a manager can't necessarily read every
-- recipient's team_members row, but must still see who is outstanding)
-- -----------------------------------------------------------------------------

create or replace function public.policy_ack_status(pid uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case
    when not private.can_see_policy(pid) or not (select private.is_at_least('manager'))
      then '[]'::jsonb
    else coalesce(jsonb_agg(jsonb_build_object(
      'team_member_id', r.team_member_id,
      'name', coalesce(nullif(tm.preferred_name, ''), tm.first_name) || ' ' || tm.last_name,
      'acknowledged_at', r.acknowledged_at
    ) order by r.acknowledged_at nulls first,
      coalesce(nullif(tm.preferred_name, ''), tm.first_name)), '[]'::jsonb)
  end
  from public.policy_recipients r
  join public.team_members tm on tm.id = r.team_member_id
  where r.policy_id = pid;
$$;

grant execute on function public.policy_ack_status(uuid) to authenticated;

create or replace function public.policy_update_ack_status(uid uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case
    when not (select private.is_at_least('manager'))
      then '[]'::jsonb
    else coalesce(jsonb_agg(jsonb_build_object(
      'team_member_id', r.team_member_id,
      'name', coalesce(nullif(tm.preferred_name, ''), tm.first_name) || ' ' || tm.last_name,
      'acknowledged_at', r.acknowledged_at
    ) order by r.acknowledged_at nulls first,
      coalesce(nullif(tm.preferred_name, ''), tm.first_name)), '[]'::jsonb)
  end
  from public.policy_update_recipients r
  join public.team_members tm on tm.id = r.team_member_id
  join public.policy_updates u on u.id = r.policy_update_id
  where r.policy_update_id = uid
    and private.can_see_policy(u.policy_id);
$$;

grant execute on function public.policy_update_ack_status(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Thread + update feeds
--
-- Definer, because RLS stops a team-member-level user from reading a coworker's
-- team_members row — without this a dealer would see a thread of anonymous
-- comments. These return only the display name and whether the author is a
-- manager (so the UI can mark an official answer), never contact details.
-- -----------------------------------------------------------------------------

create or replace function public.policy_thread(pid uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case
    when not private.can_see_policy(pid) then '[]'::jsonb
    else coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'parent_id', c.parent_id,
      'body', case when c.deleted_at is null then c.body else null end,
      'pinned', c.pinned,
      'deleted_at', c.deleted_at,
      'created_at', c.created_at,
      'created_by', c.created_by,
      'author_name', coalesce(nullif(tm.preferred_name, ''), tm.first_name) || ' ' || tm.last_name,
      'author_is_manager', tm.permission_level in
        ('super_admin', 'corporate_admin', 'location_admin', 'manager', 'scheduler')
    ) order by c.created_at), '[]'::jsonb)
  end
  from public.policy_comments c
  left join public.team_members tm on tm.id = c.created_by
  where c.policy_id = pid;
$$;

grant execute on function public.policy_thread(uuid) to authenticated;

create or replace function public.policy_updates_feed(pid uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case
    when not private.can_see_policy(pid) then '[]'::jsonb
    else coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id,
      'kind', u.kind,
      'title', u.title,
      'body', u.body,
      'requires_acknowledgment', u.requires_acknowledgment,
      'published_at', u.published_at,
      'created_at', u.created_at,
      'created_by', u.created_by,
      'author_name', coalesce(nullif(tm.preferred_name, ''), tm.first_name) || ' ' || tm.last_name
    ) order by u.published_at desc nulls first, u.created_at desc), '[]'::jsonb)
  end
  from public.policy_updates u
  left join public.team_members tm on tm.id = u.created_by
  where u.policy_id = pid
    -- drafts stay with their author and the moderators
    and (
      u.published_at is not null
      or u.created_by = private.current_team_member_id()
      or private.can_moderate_policy(u.policy_id)
    );
$$;

grant execute on function public.policy_updates_feed(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Housekeeping
-- -----------------------------------------------------------------------------

create trigger set_created_by before insert on public.policy_categories
  for each row execute function private.set_created_by();
create trigger set_updated_at before update on public.policy_categories
  for each row execute function private.set_updated_at();

create trigger set_created_by before insert on public.policies
  for each row execute function private.set_created_by();
create trigger set_updated_at before update on public.policies
  for each row execute function private.set_updated_at();

create trigger set_created_by before insert on public.policy_updates
  for each row execute function private.set_created_by();
create trigger set_updated_at before update on public.policy_updates
  for each row execute function private.set_updated_at();

create trigger set_created_by before insert on public.policy_comments
  for each row execute function private.set_created_by();
create trigger set_updated_at before update on public.policy_comments
  for each row execute function private.set_updated_at();

create trigger audit after insert or update or delete on public.policy_categories
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.policy_category_links
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.policies
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.policy_roles
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.policy_locations
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.policy_updates
  for each row execute function private.write_audit_log();
create trigger audit after insert or update or delete on public.policy_documents
  for each row execute function private.write_audit_log();

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- -----------------------------------------------------------------------------

alter table public.policy_categories       enable row level security;
alter table public.policy_category_links   enable row level security;
alter table public.policies                enable row level security;
alter table public.policy_roles            enable row level security;
alter table public.policy_locations        enable row level security;
alter table public.policy_documents        enable row level security;
alter table public.policy_updates          enable row level security;
alter table public.policy_comments         enable row level security;
alter table public.policy_recipients       enable row level security;
alter table public.policy_update_recipients enable row level security;

-- categories: everyone reads them (they're just headings, and a team member
-- needs the name to render the list). manager+ adds one; location_admin+ renames
-- or archives, since a rename reaches every club at once.
create policy "policy_categories_select" on public.policy_categories
  for select to authenticated
  using (true);
create policy "policy_categories_insert" on public.policy_categories
  for insert to authenticated
  with check ((select private.is_at_least('manager')));
create policy "policy_categories_update" on public.policy_categories
  for update to authenticated
  using ((select private.is_at_least('location_admin')))
  with check ((select private.is_at_least('location_admin')));

-- category links: readable with the policy, written by its author or a moderator
-- (same shape as the role/club junctions above)
create policy "policy_category_links_select" on public.policy_category_links
  for select to authenticated
  using (private.can_see_policy(policy_id));
create policy "policy_category_links_write" on public.policy_category_links
  for all to authenticated
  using (
    exists (select 1 from public.policies p where p.id = policy_id
            and (p.created_by = private.current_team_member_id() or private.can_moderate_policy(p.id)))
  )
  with check (
    (select private.is_at_least('manager'))
    and exists (select 1 from public.policies p where p.id = policy_id
                and (p.created_by = private.current_team_member_id() or private.can_moderate_policy(p.id)))
  );

-- policies: audience reads published; author sees own drafts; moderators in scope.
-- manager+ creates. Author/moderator edits. No delete — archive via status.
create policy "policies_select" on public.policies
  for select to authenticated
  using (private.can_see_policy(id));
create policy "policies_insert" on public.policies
  for insert to authenticated
  with check (
    created_by = private.current_team_member_id()
    and (select private.is_at_least('manager'))
  );
create policy "policies_update" on public.policies
  for update to authenticated
  using (
    created_by = private.current_team_member_id()
    or private.can_moderate_policy(id)
  )
  with check (
    created_by = private.current_team_member_id()
    or private.can_moderate_policy(id)
  );

-- audience junctions: readable with the policy, writable by author/moderator.
-- A brand-new draft has no locations yet, so can_moderate_policy() can't match
-- on one — the author check is what lets the first row in.
create policy "policy_roles_select" on public.policy_roles
  for select to authenticated
  using (private.can_see_policy(policy_id));
create policy "policy_roles_write" on public.policy_roles
  for all to authenticated
  using (
    exists (select 1 from public.policies p where p.id = policy_id
            and (p.created_by = private.current_team_member_id() or private.can_moderate_policy(p.id)))
  )
  with check (
    (select private.is_at_least('manager'))
    and exists (select 1 from public.policies p where p.id = policy_id
                and (p.created_by = private.current_team_member_id() or private.can_moderate_policy(p.id)))
  );

create policy "policy_locations_select" on public.policy_locations
  for select to authenticated
  using (private.can_see_policy(policy_id));
create policy "policy_locations_write" on public.policy_locations
  for all to authenticated
  using (
    exists (select 1 from public.policies p where p.id = policy_id
            and (p.created_by = private.current_team_member_id() or private.can_moderate_policy(p.id)))
  )
  with check (
    (select private.is_at_least('manager'))
    and private.has_location_access(location_id)
    and exists (select 1 from public.policies p where p.id = policy_id
                and (p.created_by = private.current_team_member_id() or private.can_moderate_policy(p.id)))
  );

-- documents: anyone who can see the policy may list them; manager+ attaches
create policy "policy_documents_select" on public.policy_documents
  for select to authenticated
  using (private.can_see_policy(policy_id));
create policy "policy_documents_write" on public.policy_documents
  for all to authenticated
  using (
    exists (select 1 from public.policies p where p.id = policy_id
            and (p.created_by = private.current_team_member_id() or private.can_moderate_policy(p.id)))
  )
  with check (
    (select private.is_at_least('manager'))
    and exists (select 1 from public.policies p where p.id = policy_id
                and (p.created_by = private.current_team_member_id() or private.can_moderate_policy(p.id)))
  );

-- updates: published ones visible to whoever can see the policy; drafts to
-- their author and moderators. manager+ writes.
create policy "policy_updates_select" on public.policy_updates
  for select to authenticated
  using (
    private.can_see_policy(policy_id)
    and (
      published_at is not null
      or created_by = private.current_team_member_id()
      or private.can_moderate_policy(policy_id)
    )
  );
create policy "policy_updates_insert" on public.policy_updates
  for insert to authenticated
  with check (
    created_by = private.current_team_member_id()
    and (select private.is_at_least('manager'))
    and private.can_see_policy(policy_id)
  );
create policy "policy_updates_update" on public.policy_updates
  for update to authenticated
  using (
    created_by = private.current_team_member_id()
    or private.can_moderate_policy(policy_id)
  )
  with check (
    created_by = private.current_team_member_id()
    or private.can_moderate_policy(policy_id)
  );

-- comments: everyone in the audience reads and posts. You may edit your own;
-- moderators may edit any (to pin or soft-delete). Never hard-deleted.
create policy "policy_comments_select" on public.policy_comments
  for select to authenticated
  using (private.can_see_policy(policy_id));
create policy "policy_comments_insert" on public.policy_comments
  for insert to authenticated
  with check (
    created_by = private.current_team_member_id()
    and private.can_see_policy(policy_id)
  );
create policy "policy_comments_update" on public.policy_comments
  for update to authenticated
  using (
    created_by = private.current_team_member_id()
    or private.can_moderate_policy(policy_id)
  )
  with check (
    created_by = private.current_team_member_id()
    or private.can_moderate_policy(policy_id)
  );

-- recipients: you see and acknowledge your own row; manager+ who can see the
-- policy sees all of them to tally "X of N". Inserted only by publish_policy().
create policy "policy_recipients_select" on public.policy_recipients
  for select to authenticated
  using (
    team_member_id = private.current_team_member_id()
    or ((select private.is_at_least('manager')) and private.can_see_policy(policy_id))
  );
create policy "policy_recipients_update" on public.policy_recipients
  for update to authenticated
  using (team_member_id = private.current_team_member_id())
  with check (team_member_id = private.current_team_member_id());

create policy "policy_update_recipients_select" on public.policy_update_recipients
  for select to authenticated
  using (
    team_member_id = private.current_team_member_id()
    or (
      (select private.is_at_least('manager'))
      and exists (
        select 1 from public.policy_updates u
        where u.id = policy_update_id and private.can_see_policy(u.policy_id)
      )
    )
  );
create policy "policy_update_recipients_update" on public.policy_update_recipients
  for update to authenticated
  using (team_member_id = private.current_team_member_id())
  with check (team_member_id = private.current_team_member_id());

-- -----------------------------------------------------------------------------
-- Storage: private bucket for the policy documents themselves.
-- Path convention is <policy_id>/<filename>, which is how the read policy knows
-- which policy a file belongs to. The regex guard keeps a malformed path from
-- raising a cast error that would break listing for everyone.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('policy-documents', 'policy-documents', false)
on conflict (id) do nothing;

create policy "policy_documents_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'policy-documents'
    and name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
    and private.can_see_policy(split_part(name, '/', 1)::uuid)
  );

create policy "policy_documents_upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'policy-documents'
    and (select private.is_at_least('manager'))
  );

create policy "policy_documents_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'policy-documents'
    and name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
    and private.can_moderate_policy(split_part(name, '/', 1)::uuid)
  );
