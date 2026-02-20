-- =====================================================
-- Migration: Seed Test Enterprise
-- Date: 2026-02-02
-- Purpose: Create test enterprise for development (bypasses Stripe payment)
-- =====================================================

DO $$
DECLARE
  v_enterprise_id uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_subscription_id uuid := 'bbbbbbbb-0000-0000-0000-000000000001';
  v_owner_id uuid;
BEGIN
  -- Find owner: Update this email to match your dev account
  SELECT id INTO v_owner_id
  FROM auth.users
  WHERE email = 'mleonard1616@gmail.com'
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    RAISE NOTICE 'No user found with email mleonard1616@gmail.com. Update the email in this migration.';
    RETURN;
  END IF;

  -- Insert enterprise (skip if exists)
  INSERT INTO public.enterprises (id, name, slug, billing_contact_email)
  VALUES (v_enterprise_id, 'Test Enterprise', 'test-enterprise', 'test@example.com')
  ON CONFLICT (slug) DO NOTHING;

  -- Insert active subscription (no Stripe IDs = test mode)
  -- Using per_sub_org pricing model with 10 seats
  INSERT INTO public.enterprise_subscriptions (
    id,
    enterprise_id,
    status,
    billing_interval,
    pricing_model,
    sub_org_quantity,
    alumni_tier,
    price_per_sub_org_cents,
    current_period_end
  )
  VALUES (
    v_subscription_id,
    v_enterprise_id,
    'active',
    'month',
    'per_sub_org',
    10,
    'tier_1',
    15000,
    now() + interval '30 days'
  )
  ON CONFLICT (enterprise_id) DO NOTHING;

  -- Assign owner role
  INSERT INTO public.user_enterprise_roles (user_id, enterprise_id, role)
  VALUES (v_owner_id, v_enterprise_id, 'owner')
  ON CONFLICT (user_id, enterprise_id) DO NOTHING;

  RAISE NOTICE 'Test enterprise created with owner %', v_owner_id;
END $$;
