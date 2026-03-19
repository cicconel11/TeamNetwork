-- Allow anonymous friction feedback (login/signup errors) before auth
ALTER TABLE public.form_submissions
  ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN public.form_submissions.user_id IS
  'Submitter; NULL for anonymous friction feedback (pre-auth flows).';
