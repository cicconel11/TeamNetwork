-- Add industry and experience_level columns to job_postings
ALTER TABLE public.job_postings
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS experience_level text;
