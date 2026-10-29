-- Messaging: attachments + highlight styles.
-- attachments: [{path, name, type, size}] pointing into the private
-- message-attachments bucket (path starts with the conversation id, which is
-- what the storage policies authorize on). style: an optional bubble theme
-- for hype posts; a trigger strips it for non-managers.

alter table public.messages
  add column attachments jsonb not null default '[]'::jsonb,
  add column style text check (style in ('gold', 'navy', 'party'));

-- attachment-only messages have an empty body
alter table public.messages drop constraint messages_body_check;
alter table public.messages add constraint messages_body_check
  check (length(trim(body)) > 0 or jsonb_array_length(attachments) > 0);

create or replace function private.enforce_message_style()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.style is not null and not private.is_at_least('manager') then
    new.style := null;
  end if;
  return new;
end;
$$;

create trigger zz_message_style before insert on public.messages
  for each row execute function private.enforce_message_style();

-- private bucket; files live under <conversation_id>/<uuid>-<filename>
insert into storage.buckets (id, name, public)
values ('message-attachments', 'message-attachments', false)
on conflict (id) do nothing;

create policy "message_attachments_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'message-attachments'
    and name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
    and private.is_conversation_participant(split_part(name, '/', 1)::uuid)
  );

create policy "message_attachments_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'message-attachments'
    and name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
    and (
      private.is_conversation_participant(split_part(name, '/', 1)::uuid)
      or private.can_moderate_conversation(split_part(name, '/', 1)::uuid)
    )
  );
