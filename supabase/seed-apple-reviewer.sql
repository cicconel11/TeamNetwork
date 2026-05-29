-- =====================================================
-- Seed Script: Apple App Review Tester Account
--
-- Purpose: Give an App Store reviewer a populated, multi-org account so they
-- can explore TeamNetwork. Mirrors the pattern in seed-enterprise-for-user.sql.
--
-- The reviewer is granted membership in three orgs:
--   1. "Apple Review Test Org"  — created here, donation_eligible_ios = true
--      (so the native Apple Pay donation flow is reachable per Guideline
--      3.2.1(vi)). Reviewer is admin.
--   2. "Test Org"               — created here. Reviewer is admin.
--   3. The TeamNetwork founders org — REAL production org, looked up by slug,
--      never created/modified by this script. Reviewer is added read-only
--      (alumni) so live founder data is exposed but not editable.
--
-- PREREQUISITES (do these first, in order):
--   1. The reviewer account must already exist in auth.users. Sign it up
--      through the normal app signup flow first (email + password), confirm
--      the email, then run this script. This script will NOT create the auth
--      user (password hashing / email confirmation belong to Supabase Auth).
--   2. Set the three :var values below before running.
--
-- USAGE (Supabase SQL Editor against PRODUCTION):
--   1. Edit the three placeholders in the CONFIG block.
--   2. Run. It is idempotent — safe to re-run.
--
-- ROLLBACK: see the commented block at the bottom.
-- =====================================================

DO $$
DECLARE
  -- ============ CONFIG — EDIT THESE THREE ============
  v_reviewer_email text := 'test-reviewer@myteamnetwork.com';
  -- Slug of your REAL founders org in production. Find it with:
  --   SELECT name, slug FROM organizations ORDER BY created_at LIMIT 20;
  v_founders_slug  text := 'REPLACE_WITH_FOUNDERS_ORG_SLUG';
  -- Role to grant in the founders org. 'alumni' = read-only (safe default).
  -- Use 'admin' only if the reviewer must demo admin features there.
  v_founders_role  public.user_role := 'alumni';
  -- ===================================================

  v_user_id        uuid;
  v_review_org_id  uuid;
  v_test_org_id    uuid;
  v_founders_id    uuid;
BEGIN
  -- ---- Resolve reviewer user ----
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_reviewer_email;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION
      'Reviewer % not found in auth.users. Sign the account up via the normal app signup flow first, then re-run.',
      v_reviewer_email;
  END IF;
  RAISE NOTICE 'Reviewer user: % (%)', v_reviewer_email, v_user_id;

  -- ---- Org 1: Apple Review Test Org (donation_eligible_ios = true) ----
  SELECT id INTO v_review_org_id FROM organizations WHERE slug = 'apple-review-test-org';
  IF v_review_org_id IS NULL THEN
    INSERT INTO organizations (name, slug, description, donation_eligible_ios)
    VALUES (
      'Apple Review Test Org',
      'apple-review-test-org',
      'Populated org for Apple App Store review. donation_eligible_ios = true.',
      true
    )
    RETURNING id INTO v_review_org_id;
    RAISE NOTICE 'Created Apple Review Test Org: %', v_review_org_id;
  ELSE
    -- Ensure the flag is set even if the org already existed.
    UPDATE organizations SET donation_eligible_ios = true WHERE id = v_review_org_id;
    RAISE NOTICE 'Apple Review Test Org already existed: % (flag ensured true)', v_review_org_id;
  END IF;

  INSERT INTO user_organization_roles (user_id, organization_id, role)
  VALUES (v_user_id, v_review_org_id, 'admin')
  ON CONFLICT (user_id, organization_id) DO UPDATE SET role = 'admin';

  -- ---- Org 2: Test Org ----
  SELECT id INTO v_test_org_id FROM organizations WHERE slug = 'apple-review-demo-org';
  IF v_test_org_id IS NULL THEN
    INSERT INTO organizations (name, slug, description)
    VALUES (
      'Test Org',
      'apple-review-demo-org',
      'Secondary demo org for Apple App Store review.'
    )
    RETURNING id INTO v_test_org_id;
    RAISE NOTICE 'Created Test Org: %', v_test_org_id;
  ELSE
    RAISE NOTICE 'Test Org already existed: %', v_test_org_id;
  END IF;

  INSERT INTO user_organization_roles (user_id, organization_id, role)
  VALUES (v_user_id, v_test_org_id, 'admin')
  ON CONFLICT (user_id, organization_id) DO UPDATE SET role = 'admin';

  -- ---- Org 3: TeamNetwork founders org (REAL — look up only) ----
  IF v_founders_slug = 'REPLACE_WITH_FOUNDERS_ORG_SLUG' THEN
    RAISE EXCEPTION 'Set v_founders_slug to your real founders org slug before running.';
  END IF;

  SELECT id INTO v_founders_id FROM organizations WHERE slug = v_founders_slug;
  IF v_founders_id IS NULL THEN
    RAISE EXCEPTION
      'Founders org slug "%" not found. List orgs with: SELECT name, slug FROM organizations;',
      v_founders_slug;
  END IF;

  INSERT INTO user_organization_roles (user_id, organization_id, role)
  VALUES (v_user_id, v_founders_id, v_founders_role)
  ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role;
  RAISE NOTICE 'Added reviewer to founders org % as %', v_founders_slug, v_founders_role;

  RAISE NOTICE 'SUCCESS: % is now in 3 orgs (Apple Review Test Org=admin, Test Org=admin, %=%)',
    v_reviewer_email, v_founders_slug, v_founders_role;
END
$$;

-- ---- Verify ----
SELECT
  o.name,
  o.slug,
  o.donation_eligible_ios,
  uor.role,
  uor.status
FROM user_organization_roles uor
JOIN organizations o ON o.id = uor.organization_id
JOIN auth.users u ON u.id = uor.user_id
WHERE u.email = 'test-reviewer@myteamnetwork.com'  -- keep in sync with v_reviewer_email
ORDER BY o.name;

-- =====================================================
-- ROLLBACK (removes reviewer's memberships + the two seeded test orgs;
-- never touches the real founders org's data):
--
--   DELETE FROM user_organization_roles
--   WHERE user_id = (SELECT id FROM auth.users WHERE email = 'test-reviewer@myteamnetwork.com');
--   DELETE FROM organizations WHERE slug IN ('apple-review-test-org', 'apple-review-demo-org');
--
-- To also remove the auth user, delete it from the Supabase Auth dashboard.
-- =====================================================
