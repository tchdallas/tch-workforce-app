-- =============================================================================
-- Termination details for turnover reporting. Captured when a member is
-- archived (terminated): why they left, whether they're rehire-eligible, and
-- when. Additive; all nullable (bulk/legacy archives simply have no detail).
-- =============================================================================

alter table public.team_members
  add column terminated_at        timestamptz,
  add column termination_category text,    -- 'voluntary' | 'involuntary'
  add column termination_reason   text,    -- specific reason within the category
  add column rehire_eligible      boolean,
  add column termination_note      text;
