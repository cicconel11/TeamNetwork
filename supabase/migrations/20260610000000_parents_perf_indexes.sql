-- Performance: replace dense indexes on nullable parents columns with partial indexes,
-- and add a covering index on parent_invites for the idempotency check.

-- ============================================================
-- Issue 13: Replace dense indexes with partial indexes on nullable columns.
-- Dense indexes on nullable columns include NULL entries, wasting space and
-- slowing INSERT/UPDATE on records where the column is NULL.
-- ============================================================
DROP INDEX IF EXISTS public.parents_student_name_idx;
DROP INDEX IF EXISTS public.parents_relationship_idx;

CREATE INDEX IF NOT EXISTS parents_student_name_idx
  ON public.parents (student_name)
  WHERE student_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS parents_relationship_idx
  ON public.parents (relationship)
  WHERE relationship IS NOT NULL;

-- ============================================================
-- Issue 14: Covering index for parent_invites idempotency check.
-- The invite POST checks: organization_id + email + status='pending' + expires_at > now.
-- A partial index on pending rows covers the exact access pattern.
-- ============================================================
CREATE INDEX IF NOT EXISTS parent_invites_org_email_status_idx
  ON public.parent_invites (organization_id, email, status)
  WHERE status = 'pending';
