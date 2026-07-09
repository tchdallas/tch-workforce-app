-- Per-role default shift length (hours). Falls back to the
-- default_shift_hours app setting, then 8, when null.
alter table public.roles
  add column default_shift_hours numeric(4, 2)
  check (default_shift_hours is null or (default_shift_hours > 0 and default_shift_hours <= 24));
