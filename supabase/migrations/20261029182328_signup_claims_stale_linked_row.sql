-- Companion to relink_auth_on_email_change, covering the other direction:
-- someone signs up at their member row's CURRENT email while the row is still
-- linked to an old login (whose email no longer matches the row). The new
-- signup claims the row, so nobody has to re-save the email afterwards.
-- Signups confirm the email address, so whoever owns the inbox the admin put
-- on the member row is exactly who should own the login — same trust model
-- as the original link-by-email.

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.team_members tm
  set user_id = new.id
  where lower(tm.email) = lower(new.email)
    and not exists (
      select 1 from public.team_members t where t.user_id = new.id
    )
    and (
      tm.user_id is null
      or exists (
        select 1 from auth.users u
        where u.id = tm.user_id
          and lower(u.email) <> lower(tm.email)
      )
    );
  return new;
end;
$$;
