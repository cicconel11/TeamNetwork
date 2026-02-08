-- =====================================================
-- Migration: Enterprise Security Fixes
-- Date: 2026-02-07
-- Purpose: Fix two CRITICAL security issues found during QA audit:
--   1. Revoke SELECT on enterprise_alumni_directory from authenticated
--      (view exposes PII to any logged-in user)
--   2. Add SET search_path to all SECURITY DEFINER enterprise functions
--      (prevents privilege escalation via search_path injection)
-- =====================================================

-- =====================================================
-- Part 1: Revoke public access to enterprise_alumni_directory view
-- =====================================================
-- The view joins alumni PII with org data but has no access control.
-- Only service_role should query this view (API routes already use service client).
REVOKE ALL ON public.enterprise_alumni_directory FROM authenticated;
REVOKE ALL ON public.enterprise_alumni_directory FROM anon;

-- =====================================================
-- Part 2: Fix SECURITY DEFINER functions with SET search_path
-- =====================================================

-- 2a. is_enterprise_member(uuid)
CREATE OR REPLACE FUNCTION public.is_enterprise_member(ent_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_enterprise_roles
    WHERE enterprise_id = ent_id
      AND user_id = auth.uid()
  );
$$;

-- 2b. is_enterprise_admin(uuid)
CREATE OR REPLACE FUNCTION public.is_enterprise_admin(ent_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_enterprise_roles
    WHERE enterprise_id = ent_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'billing_admin', 'org_admin')
  );
$$;

-- 2c. is_enterprise_owner(uuid)
CREATE OR REPLACE FUNCTION public.is_enterprise_owner(ent_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_enterprise_roles
    WHERE enterprise_id = ent_id
      AND user_id = auth.uid()
      AND role = 'owner'
  );
$$;

-- 2d. can_enterprise_add_alumni(uuid)
CREATE OR REPLACE FUNCTION public.can_enterprise_add_alumni(p_enterprise_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_tier text;
  v_limit integer;
  v_count integer;
  v_status text;
BEGIN
  -- Get enterprise subscription details
  SELECT alumni_tier, pooled_alumni_limit, status
  INTO v_tier, v_limit, v_status
  FROM public.enterprise_subscriptions
  WHERE enterprise_id = p_enterprise_id
  LIMIT 1;

  -- If no subscription or not active, deny
  IF v_tier IS NULL OR v_status NOT IN ('active', 'trialing') THEN
    RETURN false;
  END IF;

  -- Custom tier uses explicit limit, null means unlimited
  IF v_tier = 'custom' THEN
    IF v_limit IS NULL THEN
      RETURN true;
    END IF;
  ELSE
    -- Standard tier limits (tier_3 is unlimited in app pricing)
    v_limit := CASE v_tier
      WHEN 'tier_1' THEN 5000
      WHEN 'tier_2' THEN 10000
      WHEN 'tier_3' THEN NULL
      ELSE 0
    END;
  END IF;

  -- Unlimited tiers
  IF v_limit IS NULL THEN
    RETURN true;
  END IF;

  -- Get current alumni count across all sub-orgs
  SELECT COALESCE(total_alumni_count, 0)
  INTO v_count
  FROM public.enterprise_alumni_counts
  WHERE enterprise_id = p_enterprise_id;

  RETURN v_count < v_limit;
END;
$$;

-- 2e. enforce_enterprise_org_limit() trigger function
CREATE OR REPLACE FUNCTION public.enforce_enterprise_org_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_sub_org_quantity integer;
  v_current_count integer;
BEGIN
  -- Skip if not an enterprise organization
  IF NEW.enterprise_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get the sub_org_quantity for per_sub_org pricing model
  SELECT sub_org_quantity
  INTO v_sub_org_quantity
  FROM public.enterprise_subscriptions
  WHERE enterprise_id = NEW.enterprise_id
    AND pricing_model = 'per_sub_org';

  -- If no subscription or not per_sub_org pricing, allow the insert
  IF v_sub_org_quantity IS NULL THEN
    RETURN NEW;
  END IF;

  -- Count current enterprise-managed organizations
  SELECT COUNT(*)
  INTO v_current_count
  FROM public.organizations o
  JOIN public.organization_subscriptions os ON os.organization_id = o.id
  WHERE o.enterprise_id = NEW.enterprise_id
    AND os.status = 'enterprise_managed';

  -- Check if limit would be exceeded
  IF v_current_count >= v_sub_org_quantity THEN
    RAISE EXCEPTION 'Organization limit reached for enterprise. Current: %, Limit: %',
      v_current_count, v_sub_org_quantity
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
