-- =============================================================================
-- Tournament Downs — Phase 3a: disputes.
-- A dealer can flag a specific down card, or report missing downs in general.
-- Managers at that location see and resolve them (and can then fix the card).
-- =============================================================================

create table public.down_disputes (
  id              uuid primary key default gen_random_uuid(),
  team_member_id  uuid not null references public.team_members (id),  -- who raised it
  location_id     uuid references public.locations (id),              -- for manager scoping
  down_card_id    uuid references public.down_cards (id) on delete set null, -- optional
  message         text not null check (length(trim(message)) > 0),
  status          text not null default 'open',   -- 'open' | 'resolved'
  resolution_note text,
  resolved_by     uuid references public.team_members (id),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index down_disputes_status_idx on public.down_disputes (status, location_id);
create index down_disputes_member_idx on public.down_disputes (team_member_id);

create trigger set_updated_at before update on public.down_disputes
  for each row execute function private.set_updated_at();

-- notify managers at the location when a dispute is raised
create or replace function private.notify_down_dispute()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare r record; who text;
begin
  select coalesce(nullif(tm.preferred_name, ''), tm.first_name) || ' ' || tm.last_name
  into who from public.team_members tm where tm.id = new.team_member_id;
  for r in
    select tm.id from public.team_members tm
    where tm.status = 'active'
      and private.permission_rank(tm.permission_level) >= private.permission_rank('manager')
      and (
        private.permission_rank(tm.permission_level) >= private.permission_rank('corporate_admin')
        or new.location_id is null
        or exists (select 1 from private.member_location_ids(tm.id) l where l.location_id = new.location_id)
      )
  loop
    perform private.notify(
      r.id, 'down_dispute', 'Downs dispute raised',
      who || ' flagged an issue with tournament downs: ' || left(new.message, 120),
      'DownDispute', new.id
    );
  end loop;
  return null;
end;
$$;
create trigger notify_down_dispute after insert on public.down_disputes
  for each row execute function private.notify_down_dispute();

alter table public.down_disputes enable row level security;

-- a dealer sees/creates their own; managers at the location see + resolve
create policy "down_disputes_select" on public.down_disputes
  for select to authenticated
  using (
    team_member_id = private.current_team_member_id()
    or ((select private.is_at_least('manager')) and private.has_location_access(location_id))
  );
create policy "down_disputes_insert" on public.down_disputes
  for insert to authenticated
  with check (team_member_id = private.current_team_member_id());
create policy "down_disputes_update" on public.down_disputes
  for update to authenticated
  using (
    team_member_id = private.current_team_member_id()
    or ((select private.is_at_least('manager')) and private.has_location_access(location_id))
  )
  with check (
    team_member_id = private.current_team_member_id()
    or ((select private.is_at_least('manager')) and private.has_location_access(location_id))
  );
