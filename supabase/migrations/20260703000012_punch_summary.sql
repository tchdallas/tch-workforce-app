-- Punch feedback: the kiosk confirmation now names the role being worked, and
-- clock-out returns a full summary (role, exact in/out times, the shift's
-- scheduled break) for the person to sanity-check on the spot.

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
  role_name text;
  brk_minutes int;
  brk_note text;
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

    select ro.name into role_name from public.roles ro where ro.id = entry.role_id;
    select s.break_minutes, s.break_note into brk_minutes, brk_note
    from public.shifts s where s.id = entry.shift_id;

    return jsonb_build_object(
      'action', 'out',
      'name', coalesce(target.preferred_name, target.first_name) || ' ' || target.last_name,
      'role', role_name,
      'clock_in', entry.clock_in,
      'clock_out', now(),
      'break_minutes', brk_minutes,
      'break_note', brk_note,
      'unscheduled', entry.shift_id is null,
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

  select ro.name into role_name from public.roles ro where ro.id = entry.role_id;

  return jsonb_build_object(
    'action', 'in',
    'name', coalesce(target.preferred_name, target.first_name) || ' ' || target.last_name,
    'role', role_name,
    'clock_in', entry.clock_in,
    'break_minutes', sh.break_minutes,
    'break_note', sh.break_note,
    'unscheduled', sh.id is null,
    'scheduled_start', sh.start_at,
    'late_minutes', case when sh.id is null then null
                         else round(extract(epoch from (now() - sh.start_at)) / 60.0) end
  );
end;
$$;
