-- Chat group cover image / avatar.
--
-- Mobile code at apps/mobile/app/(app)/(drawer)/[orgSlug]/chat/index.tsx
-- uploads to a `chat-group-avatars` bucket and writes the public URL back
-- to `chat_groups.avatar_url`. Both were missing — the upload silently
-- rolled back and the cover photo "didn't load."
--
-- This migration:
--   1. Adds `avatar_url text` to `chat_groups`.
--   2. Creates the `chat-group-avatars` storage bucket (public read).
--   3. Adds storage.objects RLS so any org admin can write/replace avatars
--      for chat groups in their own org. Path convention: `<org_id>/<group_id>.<ext>`.

-- 1. Column.
alter table public.chat_groups
  add column if not exists avatar_url text;

comment on column public.chat_groups.avatar_url is
  'Public URL of the chat group cover image stored in the chat-group-avatars bucket.';

-- 2. Bucket. Public read is fine — chat covers are intentionally shareable
-- and the URL itself is unguessable (UUID-named), so listing isn't a leak
-- channel.
insert into storage.buckets (id, name, public)
values ('chat-group-avatars', 'chat-group-avatars', true)
on conflict (id) do update set public = true;

-- 3. RLS on storage.objects. Path layout is `<organization_id>/<group_id>.<ext>`,
-- so the first path segment is the org id we authorize against.

drop policy if exists chat_group_avatars_public_read on storage.objects;
create policy chat_group_avatars_public_read
  on storage.objects for select
  to public
  using (bucket_id = 'chat-group-avatars');

drop policy if exists chat_group_avatars_admin_insert on storage.objects;
create policy chat_group_avatars_admin_insert
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'chat-group-avatars'
    and exists (
      select 1
      from public.user_organization_roles uor
      where uor.user_id = (select auth.uid())
        and uor.organization_id::text = split_part(name, '/', 1)
        and uor.role::text = 'admin'
    )
  );

drop policy if exists chat_group_avatars_admin_update on storage.objects;
create policy chat_group_avatars_admin_update
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'chat-group-avatars'
    and exists (
      select 1
      from public.user_organization_roles uor
      where uor.user_id = (select auth.uid())
        and uor.organization_id::text = split_part(name, '/', 1)
        and uor.role::text = 'admin'
    )
  );

drop policy if exists chat_group_avatars_admin_delete on storage.objects;
create policy chat_group_avatars_admin_delete
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'chat-group-avatars'
    and exists (
      select 1
      from public.user_organization_roles uor
      where uor.user_id = (select auth.uid())
        and uor.organization_id::text = split_part(name, '/', 1)
        and uor.role::text = 'admin'
    )
  );
