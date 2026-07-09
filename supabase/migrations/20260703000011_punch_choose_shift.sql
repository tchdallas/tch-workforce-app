-- =============================================================================
-- Clock-in now requires an explicit choice instead of silent auto-matching:
-- the member picks one of their shifts in the current gaming day (bounded by
-- business_day_start_hour, default 4 AM -> 4 AM), or starts an unscheduled
-- shift under one of their assigned roles.
--   punch_options(p_badge) -> what the kiosk shows after a badge scan
--   punch_clock(...)       -> now takes p_shift_id OR p_role_id on clock-in
-- =============================================================================

-- unscheduled punches record which role is being worked
alter table public.time_entries add column role_id uuid references public.roles (id);

-- The gaming-day window for a location: [today's start hour, tomorrow's),
-- rolling back a day when "now" is before the boundary (e.g. 2 AM belongs to
-- yesterday's gaming day).
create or replace function private.gaming_day_window(
  p_location uuid,
  out win_start timestamptz,
  out win_end timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tz text;
  start_hour int;
  local_now timestamp;
  anchor timestamp;
begin
  tz := coalesce((select l.timezone from public.locations l where l.id = p_location), 'America/Chicago');
  start_hour := coalesce(
    (select nullif(value#>>'{}', '')::int from public.app_settings
     where key = 'business_day_start_hour' and scope = 'location' and location_id = p_location),
    (select nullif(value#>>'{}', '')::int from public.app_settings
     where key = 'business_day_start_hour' and scope = 'company'),
    4
  );
  local_now := now() at time zone tz;
  anchor := date_trunc('day', local_now);
  if extract(hour from local_now) < start_hour then
    anchor := anchor - interval '1 day';
  end if;
  win_start := (anchor + make_interval(hours => start_hour)) at time zone tz;
  win_end := win_start + interval '24 hours';
end;
$$;

-- What the kiosk offers after a badge scan: are they clocked in already, and
-- if not, which gaming-day shifts / assigned roles can they clock in under.
create or replace function public.punch_options(p_badge text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.current_team_member_id();
  target public.team_members%rowtype;
  loc uuid;
  is_kiosk_caller boolean;
  ws timestamptz;
  we timestamptz;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;
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
  select * into ws, we from private.gaming_day_window(loc);

  return jsonb_build_object(
    'name', coalesce(target.preferred_name, target.first_name) || ' ' || target.last_name,
    'clocked_in', exists (
      select 1 from public.time_entries
      where team_member_id = target.id and clock_out is null
    ),
    'shifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'start_at', s.start_at,
        'end_at', s.end_at,
        'role', ro.name,
        'location', l.name
      ) order by s.start_at)
      from public.shifts s
      left join public.roles ro on ro.id = s.role_id
      left join public.locations l on l.id = s.location_id
      where s.team_member_id = target.id
        and s.status = 'published'
        and not s.archived
        and s.start_at >= ws and s.start_at < we
        and not exists (
          select 1 from public.time_entries te
          where te.shift_id = s.id and te.team_member_id = target.id
        )
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('id', ro.id, 'name', ro.name) order by ro.name)
      from public.team_member_roles r
      join public.roles ro on ro.id = r.role_id
      where r.team_member_id = target.id and ro.status = 'active'
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.punch_options(text) to authenticated;

-- punch_clock: clock-out is unchanged; clock-in must name a shift or a role
drop function if exists public.punch_clock(text, text);

create or replace function public.punch_clock(
  p_badge text default null,
  p_photo text default null,
  p_shift_id uuid default null,
  p_role_id uuid default null
)
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

  -- clocking IN: an explicit shift or an unscheduled role is required
  if p_shift_id is not null then
    select s.* into sh from public.shifts s
    where s.id = p_shift_id
      and s.team_member_id = target.id
      and s.status = 'published'
      and not s.archived;
    if not found then
      raise exception 'That shift is not available for clock-in';
    end if;
  elsif p_role_id is not null then
    if not exists (
      select 1 from public.team_member_roles r
      where r.team_member_id = target.id and r.role_id = p_role_id
    ) then
      raise exception 'That role is not assigned to you';
    end if;
  else
    raise exception 'Choose a scheduled shift or an unscheduled role to clock in';
  end if;

  insert into public.time_entries
    (team_member_id, location_id, shift_id, role_id, clock_in, clock_in_photo, method)
  values
    (target.id,
     coalesce(sh.location_id, loc),
     sh.id,
     coalesce(sh.role_id, p_role_id),
     now(), p_photo,
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

grant execute on function public.punch_clock(text, text, uuid, uuid) to authenticated;
