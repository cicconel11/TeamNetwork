-- Storage bucket for LinkedIn profile photos captured during Apify enrichment.
--
-- LinkedIn/Apify profile-photo URLs are time-limited and expire within days, so
-- the enrichment write-back downloads the image and stores a durable copy here,
-- persisting this bucket's public URL on members/alumni/parents.photo_url.
--
-- Writes happen exclusively from the service role (apify-webhook + enrichment
-- crons), which bypasses RLS, so no authenticated insert/update policies are
-- needed — only public read so the directory/drawer can render the avatars.
-- Path convention: `<target_kind>/<id>.<ext>` (e.g. `alumni/<uuid>.jpg`,
-- `user/<uuid>.jpg`). UUID-named, so listing is not a meaningful leak channel.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'linkedin-photos',
  'linkedin-photos',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

drop policy if exists linkedin_photos_public_read on storage.objects;
create policy linkedin_photos_public_read
  on storage.objects for select
  to public
  using (bucket_id = 'linkedin-photos');
