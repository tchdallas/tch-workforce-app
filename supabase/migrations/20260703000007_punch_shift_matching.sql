-- Punch-in now auto-matches the member's scheduled shift for the day:
-- links time_entries.shift_id, reports early/late minutes, and flags
-- unscheduled clock-ins (still allowed).

create or replace function public.punch_clock(p_badge text default null, p_photo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.current_team_member_id();
  target public.team_members%rowtype;
  entry public.time_entries%rowtype;
  sh public.shifts%rowtype;
  loc uuid;
  allowed boolean := false;
  is_kiosk_caller boolean;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  if p_badge is not null and trim(p_badge) <> '' then
    select coalesce(is_kiosk, false) into is_kiosk_caller from public.team_members where id = caller;
    if not (is_kiosk_caller or private.is_at_least('manager')) then
      raise exception 'This device is not authorized for kiosk clock-in';
    end if;
    select * into target from public.team_members
    where lower(trim(tm_number)) = lower(trim(p_badge)) and status = 'active';
    if not found then
      raise exception 'Badge not recognized';
    end if;
    select home_location_id into loc from public.team_members where id = caller;
    loc := coalesce(loc, target.home_location_id);
  else
    select * into target from public.team_members where id = caller and status = 'active';
    if not found then
      raise exception 'No active team member for this login';
    end if;
    loc := target.home_location_id;
    allowed := exists (
      select 1 from public.team_member_roles r
      join public.roles ro on ro.id = r.role_id
      where r.team_member_id = target.id and ro.mobile_clock_in
    );
    if not allowed then
      allowed := coalesce(
        (select (value->>'enabled')::boolean from public.app_settings
         where key = 'mobile_clock_in' and scope = 'location' and location_id = loc),
        (select (value->>'enabled')::boolean from public.app_settings
         where key = 'mobile_clock_in' and scope = 'company'),
        false
      );
    end if;
    if not allowed then
      raise exception 'Mobile clock-in is not enabled for you — use the kiosk';
    end if;
  end if;

  select * into entry from public.time_entries
  where team_member_id = target.id and clock_out is null
  order by clock_in desc limit 1;

  if found then
    update public.time_entries
    set clock_out = now(), clock_out_photo = coalesce(p_photo, clock_out_photo)
    where id = entry.id;
    return jsonb_build_object(
      'action', 'out',
      'name', coalesce(target.preferred_name, target.first_name) || ' ' || target.last_name,
      'clock_in', entry.clock_in,
      'clock_out', now(),
      'hours', round(extract(epoch from (now() - entry.clock_in)) / 3600.0, 2)
    );
  end if;

  -- clocking IN: match today's scheduled shift (nearest published shift
  -- starting within ±12h) so lateness can be tracked; none = unscheduled
  select s.* into sh from public.shifts s
  where s.team_member_id = target.id
    and s.status = 'published'
    and not s.archived
    and s.start_at between now() - interval '12 hours' and now() + interval '12 hours'
    and s.end_at > now() - interval '2 hours'
  order by abs(extract(epoch from (s.start_at - now()))) asc
  limit 1;

  insert into public.time_entries (team_member_id, location_id, shift_id, clock_in, clock_in_photo, method)
  values (target.id, coalesce(sh.location_id, loc), sh.id, now(), p_photo,
          (case when p_badge is not null and trim(p_badge) <> '' then 'kiosk' else 'mobile' end)::public.punch_method)
  returning * into entry;

  return jsonb_build_object(
    'action', 'in',
    'name', coalesce(target.preferred_name, target.first_name) || ' ' || target.last_name,
    'clock_in', entry.clock_in,
    'unscheduled', sh.id is null,
    'scheduled_start', sh.start_at,
    'late_minutes', case when sh.id is null then null
                         else round(extract(epoch from (now() - sh.start_at)) / 60.0) end
  );
end;
$$;

grant execute on function public.punch_clock(text, text) to authenticated;
