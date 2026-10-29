-- When an admin corrects a member's email AFTER they already created a login,
-- the member row stayed linked to the OLD login. The person then signs up
-- fresh at the new address and hits "Access Restricted" — the new login is
-- linked to nobody (Alan Ly, Alex Livas, Annastassia Murphy, Oct 2026).
--
-- Fix: when a member's email changes and their linked login still carries the
-- old address, follow the email — repoint to an unclaimed login at the new
-- address if one exists. If none exists yet, keep the old link (so changing
-- the email never locks anyone out); the moment they sign up at the new
-- address, handle_new_auth_user can't claim the row (user_id not null), so an
-- admin re-saving the email, or the backfill below, completes the handoff.

create or replace function private.link_member_to_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_auth uuid;
begin
  if new.user_id is null then
    select u.id into new.user_id
    from auth.users u
    where lower(u.email) = lower(new.email)
      and not exists (
        select 1 from public.team_members t where t.user_id = u.id
      );
  elsif tg_op = 'UPDATE'
        and lower(coalesce(new.email, '')) <> lower(coalesce(old.email, ''))
        and exists (
          select 1 from auth.users u
          where u.id = new.user_id
            and lower(u.email) <> lower(coalesce(new.email, ''))
        ) then
    select u.id into v_new_auth
    from auth.users u
    where lower(u.email) = lower(new.email)
      and not exists (
        select 1 from public.team_members t where t.user_id = u.id
      );
    if v_new_auth is not null then
      new.user_id := v_new_auth;
    end if;
  end if;
  return new;
end;
$$;

-- Backfill everyone already stuck: linked login's email no longer matches the
-- profile email, and an unclaimed login exists at the profile email.
update public.team_members tm
set user_id = nu.id
from auth.users cu, auth.users nu
where cu.id = tm.user_id
  and lower(cu.email) <> lower(tm.email)
  and lower(nu.email) = lower(tm.email)
  and not exists (select 1 from public.team_members t where t.user_id = nu.id);

-- Alex Livas: his profile email was never actually changed (still the gmail),
-- but he created his company-address login already. Set the profile email —
-- the trigger above repoints his row to the new login.
update public.team_members
set email = 'alex.l@texascardhouse.com'
where id = '01ca4e66-dbe7-4166-83dd-d48c032f0106'
  and lower(email) = 'alexlivas24@gmail.com';
