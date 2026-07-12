-- =============================================================================
-- Tournament Downs — Phase 3b: end-of-pay-period dispute reminder.
-- On the LAST day of a pay period, nudge every dealer who worked downs that
-- period to review them and report any missing downs (within 24h). Pay periods
-- are the 14-day cycle anchored to Mon 2026-06-22, so the last day is when
-- (days since anchor) mod 14 = 13.
--
-- NOTE: the cron.schedule at the bottom is intentionally NOT run in dev (it
-- would notify real staff). It's applied when this ships to production.
-- =============================================================================

create or replace function private.remind_downs_dispute()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p_start date;
  p_end date;
  r record;
begin
  -- only act on the last day of a pay period
  if mod(((current_date - date '2026-06-22'))::int, 14) <> 13 then
    return;
  end if;
  p_end := current_date;
  p_start := current_date - 13;

  for r in
    select distinct d.team_member_id
    from public.downs d
    join public.down_cards dc on dc.id = d.down_card_id
    where dc.card_date between p_start and p_end
  loop
    perform private.notify(
      r.team_member_id, 'down_dispute',
      'Review your tournament downs',
      'This pay period is closing. Review your downs and report any missing downs within 24 hours.',
      null, null
    );
  end loop;
end;
$$;

-- Enable in production only (uncomment / run at deploy):
-- create extension if not exists pg_cron;
-- select cron.schedule('remind-downs-dispute', '0 9 * * *',
--   'select private.remind_downs_dispute()');
