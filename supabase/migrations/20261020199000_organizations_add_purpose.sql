ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS purpose text;
COMMENT ON COLUMN public.organizations.purpose IS 'Why this organization exists (visible to members). Distinct from description, which covers what the org does.';
