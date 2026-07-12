-- =============================================================================
-- Track when a team member was sent an app invite, so the roster can show who
-- has been invited but hasn't joined yet (joined = user_id linked). Additive.
-- =============================================================================

alter table public.team_members
  add column invited_at timestamptz;
