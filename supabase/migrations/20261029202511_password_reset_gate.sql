-- Self-serve password reset, gated: the login page asks this before sending a
-- reset email. Answers one of three states and nothing more (no names, no ids):
--   'ok'       — a current (active/invited) team member with a login at that email
--   'no_login' — a current team member, but no login exists at that email yet
--                (they should use the first-time account setup instead)
--   'no'       — anything else (unknown email, archived, suspended) — the client
--                shows a neutral message and nothing is sent
-- Callable by anon because the asker is, by definition, signed out.

create or replace function public.password_reset_allowed(p_email text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (
      select 1 from public.team_members tm
      where lower(tm.email) = lower(trim(p_email))
        and tm.status in ('active', 'invited')
    ) then 'no'
    when exists (
      select 1 from auth.users u
      where lower(u.email) = lower(trim(p_email))
    ) then 'ok'
    else 'no_login'
  end;
$$;

grant execute on function public.password_reset_allowed(text) to anon, authenticated;
