-- =============================================================================
-- last_login_at: stamped by the app the first time a member actually loads
-- their session. Distinguishes "invited (account auto-created) but never
-- opened the app" from "has actually logged in and used it" — the invite
-- flow's magic-link/auto-confirm links user_id immediately, so user_id alone
-- can't tell them apart. Additive.
-- =============================================================================

alter table public.team_members
  add column last_login_at timestamptz;
