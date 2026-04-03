-- Add authenticated DELETE policy for defense-in-depth
-- (handler uses service_role for cleanup, but this ensures DB-level protection)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Authenticated users can delete own AI schedule uploads'
  ) THEN
    CREATE POLICY "Authenticated users can delete own AI schedule uploads"
    ON storage.objects FOR DELETE
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
