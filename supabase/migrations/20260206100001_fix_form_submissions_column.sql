-- Align migration history with live DB: column is 'data' not 'responses'
-- This is a no-op if the column has already been renamed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'form_submissions'
      AND column_name = 'responses'
  ) THEN
    ALTER TABLE public.form_submissions RENAME COLUMN responses TO data;
  END IF;
END $$;
