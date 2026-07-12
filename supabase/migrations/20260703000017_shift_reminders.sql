-- =============================================================================
-- Upcoming-shift reminders
--
-- A pg_cron job (every 15 min) notifies members of a published, assigned shift
-- that is coming up, at each of their configured lead times. The schema already
-- anticipated this: notification_preferences.event_type = 'upcoming_shift' with
-- settings.lead_times_minutes (e.g. [1440, 120, 30]). No preference row → a
-- single 2-hour reminder by default. private.notify() suppresses the event for
-- anyone who turned 'upcoming_shift' off.
--
-- Reminders are deduped per (shift, lead) in sent_shift_reminders, so retiming a
-- shift or the cron re-running never double-sends the same lead. Members who
-- have called out of a shift are skipped.
-- =============================================================================

create table public.sent_shift_reminders (
  shift_id     uuid not null references public.shifts (id) on delete cascade,
  lead_minutes integer not null,
  sent_at      timestamptz not null default now(),
  primary key (shift_id, lead_minutes)
);

-- internal bookkeeping only — no client ever reads this
alter table public.sent_shift_reminders enable row level security;

-- A member's configured reminder lead times, newest-first is irrelevant; falls
-- back to a single 2-hour reminder when they've set no explicit preference.
create or replace function private.member_reminder_leads(member uuid)
returns integer[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select array_agg(v.lead order by v.lead desc)
      from public.notification_preferences np
      cross join lateral (
        select (jsonb_array_elements_text(np.settings -> 'lead_times_minutes'))::int as lead
      ) v
      where np.team_member_id = member
        and np.event_type = 'upcoming_shift'
        and np.settings ? 'lead_times_minutes'
        and v.lead > 0
    ),
    array[120]  -- default: one reminder, 2 hours before
  );
$$;

-- human phrasing for the reminder, tuned to how far out the lead is
create or replace function private.reminder_lead_label(lead_minutes integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lead_minutes >= 2880 then 'is in ' || (lead_minutes / 1440) || ' days'
    when lead_minutes >= 1440 then 'is tomorrow'
    when lead_minutes >= 120  then 'is in about ' || (lead_minutes / 60) || ' hours'
    when lead_minutes >= 60   then 'is in about an hour'
    else 'starts in ' || lead_minutes || ' minutes'
  end;
$$;

create or replace function private.send_shift_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s    public.shifts%rowtype;
  lead integer;
begin
  for s in
    select sh.*
    from public.shifts sh
    where sh.status = 'published'
      and sh.team_member_id is not null
      and sh.start_at > now()
      and sh.start_at <= now() + interval '25 hours'  -- covers up to a 1440-min lead
      and not exists (
        select 1 from public.callouts c
        where c.shift_id = sh.id and c.team_member_id = sh.team_member_id
      )
  loop
    foreach lead in array private.member_reminder_leads(s.team_member_id)
    loop
      -- fire only when the lead window was *just* crossed (within the last
      -- 20 min — comfortably wider than the 15-min cron cadence). This sends
      -- each lead once near its ideal time, and naturally skips a longer lead
      -- for a shift booked on short notice (its window opened before the shift
      -- existed) instead of firing it late with misleading wording.
      if s.start_at - make_interval(mins => lead) <= now()
         and now() < s.start_at - make_interval(mins => lead) + interval '20 minutes'
         and not exists (
           select 1 from public.sent_shift_reminders r
           where r.shift_id = s.id and r.lead_minutes = lead
         )
      then
        insert into public.sent_shift_reminders (shift_id, lead_minutes)
        values (s.id, lead)
        on conflict do nothing;

        perform private.notify(
          s.team_member_id, 'upcoming_shift', 'Upcoming Shift',
          'Your shift ' || private.reminder_lead_label(lead) || ' — ' || private.shift_when(s) || '.',
          'Shift', s.id
        );
      end if;
    end loop;
  end loop;
end;
$$;

-- run every 15 minutes
create extension if not exists pg_cron;
select cron.schedule('send-shift-reminders', '*/15 * * * *',
  'select private.send_shift_reminders()');
