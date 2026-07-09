-- Callout notifications: when a team member calls out of a shift, every
-- manager+ with access to that location hears about it immediately. Done in a
-- trigger (not the client) because members can't read team_members under RLS
-- and so can't know who their managers are.

create or replace function private.notify_callout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shifts;
  who text;
  r record;
  loc uuid;
begin
  select * into s from public.shifts where id = new.shift_id;
  loc := coalesce(new.location_id, s.location_id);

  select coalesce(nullif(tm.preferred_name, ''), tm.first_name) || ' ' || tm.last_name
  into who
  from public.team_members tm where tm.id = new.team_member_id;

  if tg_op = 'INSERT' then
    for r in
      select tm.id from public.team_members tm
      where tm.status = 'active'
        and tm.id is distinct from new.team_member_id
        and private.permission_rank(tm.permission_level) >= private.permission_rank('manager')
        and (
          private.permission_rank(tm.permission_level) >= private.permission_rank('corporate_admin')
          or tm.home_location_id = loc
          or exists (
            select 1 from public.team_member_locations x
            where x.team_member_id = tm.id and x.location_id = loc
          )
        )
    loop
      perform private.notify(
        r.id, 'callout',
        'Callout: ' || who,
        who || ' called out of their shift (' || private.shift_when(s) || ')'
          || coalesce(' — ' || nullif(new.reason, ''), '') || '. Coverage may be needed.',
        'Callout', new.id
      );
    end loop;

  elsif tg_op = 'UPDATE'
        and new.status is distinct from old.status
        and new.team_member_id is distinct from private.current_team_member_id() then
    -- a reviewer moved the callout along -> tell the member who called out
    perform private.notify(
      new.team_member_id, 'callout',
      'Callout Update',
      'Your callout for ' || private.shift_when(s) || ' is now: '
        || replace(new.status::text, '_', ' ') || '.',
      'Callout', new.id
    );
  end if;

  return null;
end;
$$;

create trigger notify_callout after insert or update on public.callouts
  for each row execute function private.notify_callout();
