-- Private bucket for AI schedule uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ai-schedule-uploads',
  'ai-schedule-uploads',
  FALSE,
  10485760,
  ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Authenticated users can upload AI schedule PDFs'
  ) THEN
    CREATE POLICY "Authenticated users can upload AI schedule PDFs"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'ai-schedule-uploads'
      AND (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[2] = auth.uid()::text
      AND EXISTS (
        SELECT 1
        FROM public.user_organization_roles uor
        WHERE uor.organization_id::text = (storage.foldername(name))[1]
          AND uor.user_id = auth.uid()
          AND uor.status = 'active'
      )
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Authenticated users can read own AI schedule PDFs'
  ) THEN
    CREATE POLICY "Authenticated users can read own AI schedule PDFs"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'ai-schedule-uploads'
      AND (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[2] = auth.uid()::text
      AND EXISTS (
        SELECT 1
        FROM public.user_organization_roles uor
        WHERE uor.organization_id::text = (storage.foldername(name))[1]
          AND uor.user_id = auth.uid()
          AND uor.status = 'active'
      )
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Service role can read AI schedule PDFs'
  ) THEN
    CREATE POLICY "Service role can read AI schedule PDFs"
    ON storage.objects FOR SELECT
    TO service_role
    USING (bucket_id = 'ai-schedule-uploads');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Service role can delete AI schedule PDFs'
  ) THEN
    CREATE POLICY "Service role can delete AI schedule PDFs"
    ON storage.objects FOR DELETE
    TO service_role
    USING (bucket_id = 'ai-schedule-uploads');
  END IF;
END$$;
