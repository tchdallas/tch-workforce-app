-- =============================================================================
-- Tournament Downs — Phase 2: pay-period settlements.
-- A manager closes a pay period for one or more locations by entering the money
-- pool; the system snapshots total downs and computes the rate (pool / downs).
-- Each dealer's earnings = their downs in that period+locations × rate.
-- =============================================================================

create table public.down_pay_periods (
  id            uuid primary key default gen_random_uuid(),
  period_start  date not null,
  period_end    date not null,
  location_ids  uuid[] not null,                 -- one or several (combined) locations
  pool_amount   numeric(12, 2) not null check (pool_amount >= 0),
  total_downs   integer not null,                -- snapshot at close
  rate          numeric(12, 4) not null,         -- pool / total_downs
  note          text,
  closed_by     uuid references public.team_members (id),
  closed_at     timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index down_pay_periods_start_idx on public.down_pay_periods (period_start);

alter table public.down_pay_periods enable row level security;

-- readable by anyone signed in (dealers need the rate for their earnings —
-- toke transparency); only manager+ closes/edits a period
create policy "down_pay_periods_select" on public.down_pay_periods
  for select to authenticated using (true);
create policy "down_pay_periods_write" on public.down_pay_periods
  for all to authenticated
  using ((select private.is_at_least('manager')))
  with check ((select private.is_at_least('manager')));
