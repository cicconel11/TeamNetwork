-- Prevent duplicate slugs within the same enterprise.
-- Partial index: only applies to organizations that belong to an enterprise.
CREATE UNIQUE INDEX IF NOT EXISTS organizations_enterprise_slug_unique
  ON public.organizations (enterprise_id, slug)
  WHERE enterprise_id IS NOT NULL;
