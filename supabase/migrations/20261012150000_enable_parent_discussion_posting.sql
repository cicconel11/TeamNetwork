-- Add parent to the stored discussion posting defaults for orgs that still
-- have the legacy default set. Custom org-specific permission choices are left
-- unchanged.

BEGIN;

UPDATE organizations
SET discussion_post_roles = ARRAY['admin', 'active_member', 'alumni', 'parent']
WHERE discussion_post_roles IS NOT NULL
  AND discussion_post_roles @> ARRAY['admin', 'active_member', 'alumni']::text[]
  AND cardinality(discussion_post_roles) = 3;

COMMIT;
