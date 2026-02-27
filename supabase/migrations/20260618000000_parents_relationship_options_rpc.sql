-- Returns distinct non-null relationship values for an org's parents directory.
-- Replaces the full-table second query in page.tsx with an index-only scan.
CREATE OR REPLACE FUNCTION public.get_parents_relationship_options(p_org_id uuid)
RETURNS TABLE(relationship text)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT p.relationship
  FROM public.parents p
  WHERE p.organization_id = p_org_id
    AND p.deleted_at IS NULL
    AND p.relationship IS NOT NULL
  ORDER BY 1;
$$;

-- Composite index that covers the DISTINCT relationship lookup.
-- Allows an index-only scan for get_parents_relationship_options().
CREATE INDEX IF NOT EXISTS parents_org_relationship_idx
  ON public.parents (organization_id, relationship)
  WHERE deleted_at IS NULL AND relationship IS NOT NULL;
