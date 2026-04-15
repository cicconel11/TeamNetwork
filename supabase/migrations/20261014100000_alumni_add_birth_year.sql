-- Add birth_year column to alumni table for Year of Birth filtering
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS birth_year integer;

CREATE INDEX IF NOT EXISTS alumni_birth_year_idx ON public.alumni(birth_year);
