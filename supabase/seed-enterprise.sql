-- =====================================================
-- Seed Script: Test Enterprise Data
-- Purpose: Create a test enterprise and assign the current user as owner
-- Usage: Run this in Supabase SQL Editor after logging in
-- =====================================================

-- Step 1: Check if test enterprise already exists
DO $$
DECLARE
  v_enterprise_id uuid;
  v_user_id uuid;
BEGIN
  -- Check if enterprise already exists
  SELECT id INTO v_enterprise_id FROM enterprises WHERE slug = 'test-enterprise';

  IF v_enterprise_id IS NOT NULL THEN
    RAISE NOTICE 'Enterprise "test-enterprise" already exists with ID: %', v_enterprise_id;
    RETURN;
  END IF;

  -- Create test enterprise
  INSERT INTO enterprises (name, slug, description, billing_contact_email)
  VALUES (
    'Test Enterprise',
    'test-enterprise',
    'Development testing enterprise account',
    'test@example.com'
  )
  RETURNING id INTO v_enterprise_id;

  RAISE NOTICE 'Created enterprise with ID: %', v_enterprise_id;

  -- Create subscription for the enterprise (required for full functionality)
  INSERT INTO enterprise_subscriptions (
    enterprise_id,
    billing_interval,
    alumni_tier,
    status
  )
  VALUES (
    v_enterprise_id,
    'month',
    'tier_1',
    'active'
  );

  RAISE NOTICE 'Created enterprise subscription';
END
$$;

-- Step 2: Output enterprise info
SELECT id, name, slug, description, created_at
FROM enterprises
WHERE slug = 'test-enterprise';

-- Step 3: Show instructions for adding user role
SELECT '
============================================================
NEXT STEP: Add yourself as enterprise owner
============================================================

Run the following SQL, replacing YOUR_USER_ID with your actual user ID:

INSERT INTO user_enterprise_roles (user_id, enterprise_id, role)
SELECT
  ''YOUR_USER_ID''::uuid,
  id,
  ''owner''
FROM enterprises
WHERE slug = ''test-enterprise''
ON CONFLICT (user_id, enterprise_id) DO NOTHING;

To find your user ID, check the auth.users table:
SELECT id, email FROM auth.users WHERE email LIKE ''%YOUR_EMAIL%'';

============================================================
' AS instructions;
