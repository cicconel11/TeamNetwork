-- Public bucket for enterprise branding assets (logos)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'enterprise-branding',
  'enterprise-branding',
  TRUE,
  5 * 1024 * 1024, -- 5MB limit
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Allow anyone to read branding assets; writes are handled via service role API
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Public read enterprise branding'
  ) THEN
    CREATE POLICY "Public read enterprise branding"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'enterprise-branding');
  END IF;
END$$;
