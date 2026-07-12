-- Creating a discipline document failed RLS: the insert policy requires
-- created_by = the caller, but the client never sent created_by. Stamp it
-- (and the default location) in a before-insert trigger so the policy's
-- with-check sees the finished row — triggers run before RLS with-check.

create or replace function private.discipline_document_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.location_id is null then
    select home_location_id into new.location_id
    from public.team_members where id = new.team_member_id;
  end if;
  if new.created_by is null then
    new.created_by := private.current_team_member_id();
  end if;
  return new;
end;
$$;

drop trigger if exists default_location on public.discipline_documents;
create trigger discipline_defaults before insert on public.discipline_documents
  for each row execute function private.discipline_document_defaults();
