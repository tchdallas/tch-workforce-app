-- =============================================================================
-- Storage: profile photos bucket (public read, signed-in upload)
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', true)
on conflict (id) do nothing;

create policy "profile_photos_read" on storage.objects
  for select to public
  using (bucket_id = 'profile-photos');

create policy "profile_photos_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'profile-photos');

create policy "profile_photos_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'profile-photos')
  with check (bucket_id = 'profile-photos');
