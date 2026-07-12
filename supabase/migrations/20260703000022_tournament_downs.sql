-- =============================================================================
-- Tournament Downs — Phase 1 (tracking)
--
-- A "down" is one ~30-min dealing rotation a dealer works during a tournament.
-- At pay time a money pool is split across all downs in a pay period
-- (rate = pool / total downs); that math is Phase 2. Phase 1 replaces the paper
-- down cards + spreadsheet: managers log tournaments and down cards (one row per
-- down), dealers see their own tally.
--
--   tournament_series (optional)
--     └─ tournaments (per location)
--          └─ down_cards (date, table #, photos)
--               └─ downs (one row per down, a dealer + optional slot/duration)
-- =============================================================================

create table public.tournament_series (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  location_id uuid references public.locations (id),
  status      public.record_status not null default 'active',
  created_by  uuid references public.team_members (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.tournaments (
  id          uuid primary key default gen_random_uuid(),
  series_id   uuid references public.tournament_series (id) on delete set null,
  name        text not null,
  location_id uuid not null references public.locations (id),
  status      public.record_status not null default 'active',
  created_by  uuid references public.team_members (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index tournaments_location_idx on public.tournaments (location_id);
create index tournaments_series_idx on public.tournaments (series_id);

create table public.down_cards (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id),
  location_id   uuid not null references public.locations (id), -- denormalized for rate/period queries
  table_number  text,
  card_date     date not null,
  note          text,
  created_by    uuid references public.team_members (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index down_cards_tournament_idx on public.down_cards (tournament_id);
create index down_cards_loc_date_idx on public.down_cards (location_id, card_date);

create table public.down_card_photos (
  id           uuid primary key default gen_random_uuid(),
  down_card_id uuid not null references public.down_cards (id) on delete cascade,
  file_url     text not null,
  created_at   timestamptz not null default now()
);
create index down_card_photos_card_idx on public.down_card_photos (down_card_id);

-- one row per down (a dealer can appear on several rows of the same card)
create table public.downs (
  id               uuid primary key default gen_random_uuid(),
  down_card_id     uuid not null references public.down_cards (id) on delete cascade,
  team_member_id   uuid not null references public.team_members (id),
  slot_number      integer,                       -- order on the physical card (optional)
  duration_minutes integer not null default 30,   -- usually 30, sometimes 40
  created_at       timestamptz not null default now()
);
create index downs_card_idx on public.downs (down_card_id);
create index downs_member_idx on public.downs (team_member_id);

-- -----------------------------------------------------------------------------
-- Housekeeping triggers
-- -----------------------------------------------------------------------------
create trigger set_created_by before insert on public.tournament_series
  for each row execute function private.set_created_by();
create trigger set_created_by before insert on public.tournaments
  for each row execute function private.set_created_by();
create trigger set_created_by before insert on public.down_cards
  for each row execute function private.set_created_by();
create trigger set_updated_at before update on public.tournament_series
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.tournaments
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.down_cards
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Definer helpers (break cross-table RLS recursion between down_cards and downs)
-- -----------------------------------------------------------------------------
create or replace function private.down_card_location(card_id uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select location_id from public.down_cards where id = card_id; $$;

-- manager+ with access to the card's location may manage it
create or replace function private.can_manage_down_card(card_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.is_at_least('manager')
     and private.has_location_access(private.down_card_location(card_id));
$$;

-- the current member has at least one down on this card (dealers see their cards)
create or replace function private.has_own_down_on_card(card_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.downs d
    where d.down_card_id = card_id
      and d.team_member_id = private.current_team_member_id()
  );
$$;

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- -----------------------------------------------------------------------------
alter table public.tournament_series enable row level security;
alter table public.tournaments       enable row level security;
alter table public.down_cards        enable row level security;
alter table public.down_card_photos  enable row level security;
alter table public.downs             enable row level security;

-- series + tournaments: readable by anyone signed in (just event names);
-- manager+ creates/edits (tournaments scoped to a location they can access)
create policy "tournament_series_select" on public.tournament_series
  for select to authenticated using (true);
create policy "tournament_series_write" on public.tournament_series
  for all to authenticated
  using ((select private.is_at_least('manager')))
  with check ((select private.is_at_least('manager')));

create policy "tournaments_select" on public.tournaments
  for select to authenticated using (true);
create policy "tournaments_write" on public.tournaments
  for all to authenticated
  using ((select private.is_at_least('manager')) and private.has_location_access(location_id))
  with check ((select private.is_at_least('manager')) and private.has_location_access(location_id));

-- down cards: managers manage in-location; a dealer sees a card they're on
create policy "down_cards_select" on public.down_cards
  for select to authenticated
  using (private.can_manage_down_card(id) or private.has_own_down_on_card(id));
create policy "down_cards_write" on public.down_cards
  for all to authenticated
  using ((select private.is_at_least('manager')) and private.has_location_access(location_id))
  with check ((select private.is_at_least('manager')) and private.has_location_access(location_id));

create policy "down_card_photos_select" on public.down_card_photos
  for select to authenticated
  using (private.can_manage_down_card(down_card_id) or private.has_own_down_on_card(down_card_id));
create policy "down_card_photos_write" on public.down_card_photos
  for all to authenticated
  using (private.can_manage_down_card(down_card_id))
  with check (private.can_manage_down_card(down_card_id));

-- downs: a dealer sees their own; managers see/manage everything on cards in
-- their locations
create policy "downs_select" on public.downs
  for select to authenticated
  using (
    team_member_id = private.current_team_member_id()
    or private.can_manage_down_card(down_card_id)
  );
create policy "downs_write" on public.downs
  for all to authenticated
  using (private.can_manage_down_card(down_card_id))
  with check (private.can_manage_down_card(down_card_id));
