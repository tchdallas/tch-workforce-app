-- Per-user UI preferences that should follow the person across devices.
-- Nav favorites and dashboard quick actions previously lived in
-- localStorage, so they evaporated on other devices / cleared browsers.
-- One row per member; the client migrates any legacy localStorage values in
-- on first load. Deliberately NOT audited — pure cosmetics, would be noise.

create table public.user_ui_prefs (
  id             uuid primary key default gen_random_uuid(),
  team_member_id uuid not null unique references public.team_members (id) on delete cascade,
  nav_favorites  jsonb not null default '[]'::jsonb, -- ordered array of nav paths
  quick_actions  jsonb,                              -- null = role defaults apply
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger set_updated_at before update on public.user_ui_prefs
  for each row execute function private.set_updated_at();

alter table public.user_ui_prefs enable row level security;

-- strictly personal: nobody reads or writes anyone else's prefs, not even admins
create policy "user_ui_prefs_select" on public.user_ui_prefs
  for select to authenticated
  using (team_member_id = private.current_team_member_id());
create policy "user_ui_prefs_insert" on public.user_ui_prefs
  for insert to authenticated
  with check (team_member_id = private.current_team_member_id());
create policy "user_ui_prefs_update" on public.user_ui_prefs
  for update to authenticated
  using (team_member_id = private.current_team_member_id())
  with check (team_member_id = private.current_team_member_id());
