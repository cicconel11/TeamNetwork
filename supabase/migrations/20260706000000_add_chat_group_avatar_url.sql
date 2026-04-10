-- Add avatar_url to chat_groups table
ALTER TABLE public.chat_groups
  ADD COLUMN IF NOT EXISTS avatar_url TEXT NULL;

-- Create chat-group-avatars storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-group-avatars',
  'chat-group-avatars',
  TRUE,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for chat group avatars (public read, admin write)
DROP POLICY IF EXISTS "chat_group_avatars_select" ON storage.objects;
CREATE POLICY "chat_group_avatars_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'chat-group-avatars');

DROP POLICY IF EXISTS "chat_group_avatars_insert" ON storage.objects;
CREATE POLICY "chat_group_avatars_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'chat-group-avatars'
    AND has_active_role(
      (SELECT organization_id FROM public.chat_groups
       WHERE id = (string_to_array(name, '/'))[2]::uuid LIMIT 1),
      array['admin']
    )
  );

DROP POLICY IF EXISTS "chat_group_avatars_update" ON storage.objects;
CREATE POLICY "chat_group_avatars_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'chat-group-avatars'
    AND has_active_role(
      (SELECT organization_id FROM public.chat_groups
       WHERE id = (string_to_array(name, '/'))[2]::uuid LIMIT 1),
      array['admin']
    )
  );

NOTIFY pgrst, 'reload schema';
