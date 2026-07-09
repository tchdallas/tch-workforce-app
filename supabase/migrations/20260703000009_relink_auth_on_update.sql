-- The email→auth-account link was only attempted on INSERT (of a member row or
-- of an auth user). Two real-world cases slipped through:
--   1. an admin fixes a member's email after the person already signed up
--   2. a client write echoes back a stale user_id = null, wiping the link
-- Re-running the link on every UPDATE that leaves user_id empty self-heals both.
drop trigger if exists link_member_to_auth_user on public.team_members;
create trigger link_member_to_auth_user
  before insert or update on public.team_members
  for each row execute function private.link_member_to_auth_user();

-- Heal any rows currently unlinked whose email matches an existing login
-- (Joe Demaio's row lost its link this way).
update public.team_members tm
set user_id = u.id
from auth.users u
where tm.user_id is null
  and lower(tm.email) = lower(u.email);
