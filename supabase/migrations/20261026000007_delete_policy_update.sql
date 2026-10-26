-- Policy updates can be deleted by their author or a policy moderator
-- (location_admin+ over a covered club, corporate_admin+ anywhere).
-- Hard delete is right here: an update is an announcement post, not a record —
-- recipients/acks cascade away with it and the audit trigger keeps the history.

create or replace function public.delete_policy_update(uid uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  u public.policy_updates;
begin
  select * into u from public.policy_updates where id = uid;
  if not found then
    raise exception 'update not found';
  end if;
  if u.created_by is distinct from private.current_team_member_id()
     and not private.can_moderate_policy(u.policy_id) then
    raise exception 'only the author or a location admin may delete this update';
  end if;
  delete from public.policy_updates where id = uid;
end;
$$;

grant execute on function public.delete_policy_update(uuid) to authenticated;
