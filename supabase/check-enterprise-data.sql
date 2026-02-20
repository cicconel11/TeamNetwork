-- =====================================================
-- Diagnostic Script: Check Enterprise Data
-- Purpose: Verify enterprise tables have data
-- Usage: Run in Supabase SQL Editor
-- =====================================================

-- Check 1: List all enterprises
SELECT '=== ENTERPRISES ===' AS section;
SELECT id, name, slug, created_at
FROM enterprises
ORDER BY created_at DESC;

-- Check 2: List all enterprise subscriptions
SELECT '=== ENTERPRISE SUBSCRIPTIONS ===' AS section;
SELECT es.id, e.slug, es.status, es.alumni_tier, es.billing_interval
FROM enterprise_subscriptions es
JOIN enterprises e ON e.id = es.enterprise_id
ORDER BY es.created_at DESC;

-- Check 3: List all user enterprise roles
SELECT '=== USER ENTERPRISE ROLES ===' AS section;
SELECT uer.id, u.email, e.slug AS enterprise_slug, uer.role, uer.created_at
FROM user_enterprise_roles uer
JOIN auth.users u ON u.id = uer.user_id
JOIN enterprises e ON e.id = uer.enterprise_id
ORDER BY uer.created_at DESC;

-- Check 4: List users without enterprise roles (candidates for assignment)
SELECT '=== USERS WITHOUT ENTERPRISE ACCESS ===' AS section;
SELECT u.id, u.email, u.created_at
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM user_enterprise_roles uer WHERE uer.user_id = u.id
)
ORDER BY u.created_at DESC
LIMIT 10;

-- Summary
SELECT '=== SUMMARY ===' AS section;
SELECT
  (SELECT COUNT(*) FROM enterprises) AS total_enterprises,
  (SELECT COUNT(*) FROM enterprise_subscriptions) AS total_subscriptions,
  (SELECT COUNT(*) FROM user_enterprise_roles) AS total_user_roles,
  (SELECT COUNT(DISTINCT user_id) FROM user_enterprise_roles) AS users_with_access;
