-- Recreate two views with `security_invoker=on` so RLS is evaluated against
-- the calling user instead of the view owner. Flagged by Postgres advisors
-- at ERROR level (CVE-class: data exposure across tenants).
--
-- Original definitions captured from production on 2026-12-07 via
-- `pg_get_viewdef`. Bodies unchanged; only the security context flips.

BEGIN;

DROP VIEW IF EXISTS public.enterprise_alumni_counts;
CREATE VIEW public.enterprise_alumni_counts
WITH (security_invoker = on) AS
SELECT
  e.id AS enterprise_id,
  count(DISTINCT CASE WHEN os.status = 'enterprise_managed'::text THEN a.id ELSE NULL::uuid END) AS total_alumni_count,
  count(DISTINCT o.id) AS sub_org_count,
  count(DISTINCT CASE WHEN os.status = 'enterprise_managed'::text THEN o.id ELSE NULL::uuid END) AS enterprise_managed_org_count
FROM enterprises e
LEFT JOIN organizations o ON o.enterprise_id = e.id
LEFT JOIN organization_subscriptions os ON os.organization_id = o.id
LEFT JOIN alumni a ON a.organization_id = o.id AND a.deleted_at IS NULL
GROUP BY e.id;

DROP VIEW IF EXISTS public.mentee_latest_intake;
CREATE VIEW public.mentee_latest_intake
WITH (security_invoker = on) AS
SELECT DISTINCT ON (fs.user_id, f.organization_id)
  fs.id,
  fs.form_id,
  fs.user_id,
  fs.submitted_at,
  fs.data,
  f.organization_id
FROM form_submissions fs
JOIN forms f ON f.id = fs.form_id
WHERE f.form_kind = 'mentee_intake'::text
  AND fs.deleted_at IS NULL
  AND f.deleted_at IS NULL
ORDER BY fs.user_id, f.organization_id, fs.submitted_at DESC;

COMMIT;
