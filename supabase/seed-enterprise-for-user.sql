-- =====================================================
-- Seed Script: Create Test Enterprise & Add User as Owner
-- Purpose: One-step setup for enterprise testing
--
-- USAGE:
-- 1. Replace 'YOUR_EMAIL_HERE' with your actual email on line 14
-- 2. Run this script in Supabase SQL Editor
-- =====================================================

DO $$
DECLARE
  v_enterprise_id uuid;
  v_user_id uuid;
  -- IMPORTANT: Change this to your email address
  v_user_email text := 'YOUR_EMAIL_HERE';
BEGIN
  -- Find user by email
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = v_user_email;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found with email: %. Please update v_user_email on line 14.', v_user_email;
  END IF;

  RAISE NOTICE 'Found user: % (ID: %)', v_user_email, v_user_id;

  -- Check if enterprise already exists
  SELECT id INTO v_enterprise_id FROM enterprises WHERE slug = 'test-enterprise';

  IF v_enterprise_id IS NULL THEN
    -- Create test enterprise
    INSERT INTO enterprises (name, slug, description, billing_contact_email)
    VALUES (
      'Test Enterprise',
      'test-enterprise',
      'Development testing enterprise account',
      v_user_email
    )
    RETURNING id INTO v_enterprise_id;

    RAISE NOTICE 'Created enterprise with ID: %', v_enterprise_id;

    -- Create subscription for the enterprise
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
  ELSE
    RAISE NOTICE 'Enterprise already exists with ID: %', v_enterprise_id;
  END IF;

  -- Add user as owner (or do nothing if already exists)
  INSERT INTO user_enterprise_roles (user_id, enterprise_id, role)
  VALUES (v_user_id, v_enterprise_id, 'owner')
  ON CONFLICT (user_id, enterprise_id) DO NOTHING;

  RAISE NOTICE 'SUCCESS: User % is now an owner of Test Enterprise', v_user_email;
  RAISE NOTICE 'Refresh /app page to see the enterprise section';
END
$$;

-- Verify the setup
SELECT
  e.name AS enterprise_name,
  e.slug AS enterprise_slug,
  uer.role AS your_role,
  es.status AS subscription_status,
  u.email AS user_email
FROM enterprises e
JOIN user_enterprise_roles uer ON uer.enterprise_id = e.id
JOIN enterprise_subscriptions es ON es.enterprise_id = e.id
JOIN auth.users u ON u.id = uer.user_id
WHERE e.slug = 'test-enterprise';
