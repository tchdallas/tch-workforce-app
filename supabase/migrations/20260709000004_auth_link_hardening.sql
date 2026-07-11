-- Creating a team member whose email matched an auth account that was ALREADY
-- linked to another team member blew up with a unique-constraint violation
-- (team_members_user_id unique). The link-on-insert trigger now only claims an
-- auth account that no other member holds; otherwise the new row is simply
-- created unlinked, and admins can sort out who owns the login.

create or replace function private.link_member_to_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is null then
    select u.id into new.user_id
    from auth.users u
    where lower(u.email) = lower(new.email)
      and not exists (
        select 1 from public.team_members t where t.user_id = u.id
      );
  end if;
  return new;
end;
$$;

-- same hardening for the signup direction: only link to a member row that has
-- no account yet AND only when the new auth user isn't somehow already linked
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.team_members
  set user_id = new.id
  where user_id is null
    and lower(email) = lower(new.email)
    and not exists (
      select 1 from public.team_members t where t.user_id = new.id
    );
  return new;
end;
$$;
