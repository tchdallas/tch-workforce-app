-- =============================================================================
-- Domain 3: Requests & coverage
-- time off, shift trades, shift giveaways, open-shift claims, callouts
--
-- Shared shape: a member creates a request about themselves (status forced to
-- the initial state), and can cancel it while undecided. Time off, claims, and
-- callouts are reviewed by manager+. Trades and giveaways complete directly on
-- acceptance by default — the only gate is role + location qualification,
-- enforced in RLS — unless the 'shift_swap_approval' setting (Domain 4)
-- routes them to manager approval. No table in this domain has a DELETE
-- policy — requests are cancelled/denied, never removed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums (request_status for time off / claims was created in Domain 2)
-- -----------------------------------------------------------------------------

create type public.trade_status as enum (
  'pending_team_member',
  'pending_manager',
  'approved',
  'denied',
  'cancelled'
);

create type public.giveaway_status as enum (
  'open',
  'pending_manager',
  'approved',
  'denied',
  'cancelled',
  'accepted'
);

create type public.giveaway_offer_type as enum (
  'specific',
  'qualified_location',
  'qualified_all'
);

create type public.callout_status as enum (
  'submitted',
  'coverage_needed',
  'converted_to_open',
  'covered',
  'cancelled'
);

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- definer lookup so member-facing policies can reason about a shift's location
-- without needing read access to the shifts table itself
create or replace function private.shift_location_id(shift uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select location_id from public.shifts where id = shift;
$$;

-- per-member swap blocks, each independently toggleable by a manager
create or replace function private.swap_give_blocked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select no_shift_swap_give
     from public.team_members
     where id = private.current_team_member_id()),
    false
  );
$$;

create or replace function private.swap_receive_blocked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select no_shift_swap_receive
     from public.team_members
     where id = private.current_team_member_id()),
    false
  );
$$;

-- is this shift currently assigned to the current member?
create or replace function private.owns_shift(shift uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shifts s
    where s.id = shift
      and s.team_member_id = private.current_team_member_id()
  );
$$;

-- the only default requirement to take a shift: the member has the shift's
-- role assigned and works at the shift's location
create or replace function private.is_qualified_for_shift(shift uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shifts s
    where s.id = shift
      and exists (
        select 1
        from public.team_member_roles r
        where r.team_member_id = private.current_team_member_id()
          and r.role_id = s.role_id
      )
      and exists (
        select 1
        from private.member_location_ids(private.current_team_member_id()) l
        where l.location_id = s.location_id
      )
  );
$$;

-- can the current user review coverage at this shift's location? (manager+)
create or replace function private.can_review_shift(shift uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_at_least('manager')
     and private.has_location_access(private.shift_location_id(shift));
$$;

-- -----------------------------------------------------------------------------
-- time_off_requests
-- -----------------------------------------------------------------------------

create table public.time_off_requests (
  id             uuid primary key default gen_random_uuid(),
  team_member_id uuid not null references public.team_members (id),
  start_at       timestamptz not null,
  end_at         timestamptz not null,
  is_full_day    boolean not null default true,
  reason         text,
  note           text,
  status         public.request_status not null default 'pending',
  reviewed_by    uuid references public.team_members (id),
  reviewed_at    timestamptz,
  manager_note   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (end_at > start_at)
);

create index time_off_requests_member_idx on public.time_off_requests (team_member_id, start_at);
create index time_off_requests_pending_idx on public.time_off_requests (status) where status = 'pending';

-- -----------------------------------------------------------------------------
-- shift_trade_requests
-- -----------------------------------------------------------------------------

create table public.shift_trade_requests (
  id                        uuid primary key default gen_random_uuid(),
  requesting_team_member_id uuid not null references public.team_members (id),
  target_team_member_id     uuid not null references public.team_members (id),
  original_shift_id         uuid not null references public.shifts (id),
  requested_shift_id        uuid not null references public.shifts (id),
  status                    public.trade_status not null default 'pending_team_member',
  reviewed_by               uuid references public.team_members (id),
  reviewed_at               timestamptz,
  manager_note              text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check (requesting_team_member_id <> target_team_member_id),
  check (original_shift_id <> requested_shift_id)
);

create index shift_trade_requests_requesting_idx on public.shift_trade_requests (requesting_team_member_id);
create index shift_trade_requests_target_idx on public.shift_trade_requests (target_team_member_id);

-- -----------------------------------------------------------------------------
-- shift_giveaway_requests (+ specific-offer targets)
-- -----------------------------------------------------------------------------

create table public.shift_giveaway_requests (
  id                       uuid primary key default gen_random_uuid(),
  original_team_member_id  uuid not null references public.team_members (id),
  accepting_team_member_id uuid references public.team_members (id),
  shift_id                 uuid not null references public.shifts (id),
  offer_type               public.giveaway_offer_type not null default 'qualified_location',
  status                   public.giveaway_status not null default 'open',
  reviewed_by              uuid references public.team_members (id),
  reviewed_at              timestamptz,
  manager_note             text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index shift_giveaway_requests_original_idx on public.shift_giveaway_requests (original_team_member_id);
create index shift_giveaway_requests_shift_idx on public.shift_giveaway_requests (shift_id);

-- base44 targetTeamMemberIds array -> junction (who a 'specific' offer goes to)
create table public.shift_giveaway_targets (
  giveaway_id    uuid not null references public.shift_giveaway_requests (id) on delete cascade,
  team_member_id uuid not null references public.team_members (id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (giveaway_id, team_member_id)
);

create index shift_giveaway_targets_member_idx on public.shift_giveaway_targets (team_member_id);

-- definer helpers so giveaway policies and target policies can reference each
-- other without RLS recursion
create or replace function private.giveaway_targets_me(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shift_giveaway_targets t
    where t.giveaway_id = gid
      and t.team_member_id = private.current_team_member_id()
  );
$$;

create or replace function private.owns_giveaway(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shift_giveaway_requests g
    where g.id = gid
      and g.original_team_member_id = private.current_team_member_id()
  );
$$;

-- is this open giveaway visible to the current member as a potential taker?
create or replace function private.giveaway_open_to_me(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shift_giveaway_requests g
    where g.id = gid
      and g.status = 'open'
      and (
        private.giveaway_targets_me(gid)
        or g.offer_type = 'qualified_all'
        or (
          g.offer_type = 'qualified_location'
          and private.has_location_access(private.shift_location_id(g.shift_id))
        )
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- open_shift_claims
-- -----------------------------------------------------------------------------

create table public.open_shift_claims (
  id             uuid primary key default gen_random_uuid(),
  shift_id       uuid not null references public.shifts (id),
  team_member_id uuid not null references public.team_members (id),
  status         public.request_status not null default 'pending',
  reviewed_by    uuid references public.team_members (id),
  reviewed_at    timestamptz,
  manager_note   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index open_shift_claims_shift_idx on public.open_shift_claims (shift_id);
create index open_shift_claims_member_idx on public.open_shift_claims (team_member_id);
-- one live claim per member per shift (re-claiming after a cancel is fine)
create unique index open_shift_claims_live_key
  on public.open_shift_claims (shift_id, team_member_id)
  where status = 'pending';

-- -----------------------------------------------------------------------------
-- callouts
-- -----------------------------------------------------------------------------

create table public.callouts (
  id             uuid primary key default gen_random_uuid(),
  shift_id       uuid not null references public.shifts (id),
  team_member_id uuid not null references public.team_members (id),
  location_id    uuid references public.locations (id), -- denormalized from the shift
  role_id        uuid references public.roles (id),     -- denormalized from the shift
  reason         text,
  note           text,
  status         public.callout_status not null default 'submitted',
  submitted_at   timestamptz not null default now(),
  reviewed_by    uuid references public.team_members (id),
  reviewed_at    timestamptz,
  manager_note   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index callouts_shift_idx on public.callouts (shift_id);
create index callouts_member_idx on public.callouts (team_member_id);
create index callouts_location_idx on public.callouts (location_id);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

create trigger set_updated_at before update on public.time_off_requests
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.shift_trade_requests
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.shift_giveaway_requests
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.open_shift_claims
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.callouts
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- -----------------------------------------------------------------------------

alter table public.time_off_requests enable row level security;
alter table public.shift_trade_requests enable row level security;
alter table public.shift_giveaway_requests enable row level security;
alter table public.shift_giveaway_targets enable row level security;
alter table public.open_shift_claims enable row level security;
alter table public.callouts enable row level security;

-- time off: own requests; scheduler+ sees requests at their locations (they
-- schedule around them); manager+ reviews
create policy "time_off_requests_select" on public.time_off_requests
  for select to authenticated
  using (
    team_member_id = private.current_team_member_id()
    or (
      (select private.is_at_least('scheduler'))
      and private.shares_location_with(team_member_id)
    )
  );
create policy "time_off_requests_insert" on public.time_off_requests
  for insert to authenticated
  with check (
    (team_member_id = private.current_team_member_id() and status = 'pending')
    or private.can_manage_member(team_member_id)
  );
create policy "time_off_requests_update" on public.time_off_requests
  for update to authenticated
  using (
    (team_member_id = private.current_team_member_id() and status = 'pending')
    or private.can_manage_member(team_member_id)
  )
  with check (
    (team_member_id = private.current_team_member_id() and status in ('pending', 'cancelled'))
    or private.can_manage_member(team_member_id)
  );

-- trades: requester can only cancel; target can decline (-> denied) or accept.
-- By default accepting completes the trade directly (-> approved) — the only
-- gate is role + location qualification, enforced here. If the
-- 'shift_swap_approval' setting requires approval (Domain 4 trigger), the
-- acceptance is routed to pending_manager instead. Manager+ can always act
-- directly. no_shift_swap_give blocks initiating; _receive blocks accepting.
create policy "shift_trade_requests_select" on public.shift_trade_requests
  for select to authenticated
  using (
    requesting_team_member_id = private.current_team_member_id()
    or target_team_member_id = private.current_team_member_id()
    or private.can_manage_member(requesting_team_member_id)
    or private.can_manage_member(target_team_member_id)
  );
create policy "shift_trade_requests_insert" on public.shift_trade_requests
  for insert to authenticated
  with check (
    (
      requesting_team_member_id = private.current_team_member_id()
      and status = 'pending_team_member'
      and not private.swap_give_blocked()
      and private.owns_shift(original_shift_id)
      and private.is_qualified_for_shift(requested_shift_id)
    )
    or private.can_manage_member(requesting_team_member_id)
  );
create policy "shift_trade_requests_update" on public.shift_trade_requests
  for update to authenticated
  using (
    (
      requesting_team_member_id = private.current_team_member_id()
      and status in ('pending_team_member', 'pending_manager')
    )
    or (
      target_team_member_id = private.current_team_member_id()
      and status = 'pending_team_member'
    )
    or private.can_manage_member(requesting_team_member_id)
    or private.can_manage_member(target_team_member_id)
  )
  with check (
    (
      requesting_team_member_id = private.current_team_member_id()
      and status = 'cancelled'
    )
    or (
      target_team_member_id = private.current_team_member_id()
      and status = 'denied'
    )
    or (
      target_team_member_id = private.current_team_member_id()
      and status in ('approved', 'pending_manager')
      and not private.swap_receive_blocked()
      and private.is_qualified_for_shift(original_shift_id)
    )
    or private.can_manage_member(requesting_team_member_id)
    or private.can_manage_member(target_team_member_id)
  );

-- giveaways: owner cancels; a targeted/qualified member accepts by setting
-- themselves as accepting. By default acceptance completes directly
-- (-> accepted) — the only gate is role + location qualification, enforced
-- here in RLS. If the 'shift_swap_approval' setting requires approval
-- (Domain 4 trigger), acceptance is routed to pending_manager instead.
-- Manager+ can always act directly (override).
create policy "shift_giveaway_requests_select" on public.shift_giveaway_requests
  for select to authenticated
  using (
    original_team_member_id = private.current_team_member_id()
    or accepting_team_member_id = private.current_team_member_id()
    or private.giveaway_open_to_me(id)
    or private.can_manage_member(original_team_member_id)
    or private.can_review_shift(shift_id)
  );
create policy "shift_giveaway_requests_insert" on public.shift_giveaway_requests
  for insert to authenticated
  with check (
    (
      original_team_member_id = private.current_team_member_id()
      and status = 'open'
      and accepting_team_member_id is null
      and not private.swap_give_blocked()
      and private.owns_shift(shift_id)
    )
    or private.can_manage_member(original_team_member_id)
  );
create policy "shift_giveaway_requests_update" on public.shift_giveaway_requests
  for update to authenticated
  using (
    (
      original_team_member_id = private.current_team_member_id()
      and status in ('open', 'pending_manager')
    )
    or private.giveaway_open_to_me(id)
    or private.can_manage_member(original_team_member_id)
    or private.can_review_shift(shift_id)
  )
  with check (
    (
      original_team_member_id = private.current_team_member_id()
      and status = 'cancelled'
    )
    or (
      accepting_team_member_id = private.current_team_member_id()
      and status in ('accepted', 'pending_manager')
      and not private.swap_receive_blocked()
      and private.is_qualified_for_shift(shift_id)
    )
    or private.can_manage_member(original_team_member_id)
    or private.can_review_shift(shift_id)
  );

-- giveaway targets: targeted members see their own row; the offer's owner and
-- manager+ manage the list
create policy "shift_giveaway_targets_select" on public.shift_giveaway_targets
  for select to authenticated
  using (
    team_member_id = private.current_team_member_id()
    or private.owns_giveaway(giveaway_id)
    or (select private.is_at_least('manager'))
  );
create policy "shift_giveaway_targets_insert" on public.shift_giveaway_targets
  for insert to authenticated
  with check (
    private.owns_giveaway(giveaway_id)
    or (select private.is_at_least('manager'))
  );
create policy "shift_giveaway_targets_delete" on public.shift_giveaway_targets
  for delete to authenticated
  using (
    private.owns_giveaway(giveaway_id)
    or (select private.is_at_least('manager'))
  );

-- open-shift claims: members claim for themselves and can cancel while
-- pending; manager+ at the shift's location reviews
create policy "open_shift_claims_select" on public.open_shift_claims
  for select to authenticated
  using (
    team_member_id = private.current_team_member_id()
    or private.can_review_shift(shift_id)
  );
create policy "open_shift_claims_insert" on public.open_shift_claims
  for insert to authenticated
  with check (
    (team_member_id = private.current_team_member_id() and status = 'pending')
    or private.can_review_shift(shift_id)
  );
create policy "open_shift_claims_update" on public.open_shift_claims
  for update to authenticated
  using (
    (team_member_id = private.current_team_member_id() and status = 'pending')
    or private.can_review_shift(shift_id)
  )
  with check (
    (team_member_id = private.current_team_member_id() and status in ('pending', 'cancelled'))
    or private.can_review_shift(shift_id)
  );

-- callouts: members call out of their own shift and can cancel while
-- submitted; manager+ at the location works the coverage flow
create policy "callouts_select" on public.callouts
  for select to authenticated
  using (
    team_member_id = private.current_team_member_id()
    or (
      (select private.is_at_least('manager'))
      and private.has_location_access(
        coalesce(location_id, private.shift_location_id(shift_id))
      )
    )
  );
create policy "callouts_insert" on public.callouts
  for insert to authenticated
  with check (
    (
      team_member_id = private.current_team_member_id()
      and status = 'submitted'
      and private.owns_shift(shift_id)
    )
    or private.can_review_shift(shift_id)
  );
create policy "callouts_update" on public.callouts
  for update to authenticated
  using (
    (team_member_id = private.current_team_member_id() and status = 'submitted')
    or private.can_review_shift(shift_id)
  )
  with check (
    (team_member_id = private.current_team_member_id() and status in ('submitted', 'cancelled'))
    or private.can_review_shift(shift_id)
  );
