-- =============================================================================
-- Time-off pay type: distinguish paid (PTO) from unpaid requests.
-- Additive and inert — existing requests default to 'unpaid'; nothing changes
-- until the UI lets members choose and managers reclassify.
-- =============================================================================

create type public.time_off_pay_type as enum ('paid', 'unpaid');

alter table public.time_off_requests
  add column pay_type public.time_off_pay_type not null default 'unpaid';
