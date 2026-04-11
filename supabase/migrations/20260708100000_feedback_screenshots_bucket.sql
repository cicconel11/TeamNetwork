-- Friction-feedback screenshots: uploads via service-role API only; public read for admin email links
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'feedback-screenshots',
  'feedback-screenshots',
  TRUE,
  5 * 1024 * 1024,
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read for admin email links; writes are service-role only from API routes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Public read feedback screenshots'
  ) THEN
    CREATE POLICY "Public read feedback screenshots"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'feedback-screenshots');
  END IF;
END$$;
