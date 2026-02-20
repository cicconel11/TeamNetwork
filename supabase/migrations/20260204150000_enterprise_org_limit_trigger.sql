-- =====================================================
-- Migration: Enterprise Organization Limit Trigger
-- Date: 2026-02-04
-- Purpose: Defense-in-depth enforcement of organization limits at database level
-- =====================================================

-- =====================================================
-- Part 1: Create Enforcement Function
-- =====================================================

-- Enforces organization limits for enterprises using per_sub_org pricing model.
-- This is a defense-in-depth measure; the API should also enforce limits.
CREATE OR REPLACE FUNCTION public.enforce_enterprise_org_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
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
    AND os.status = 'enterprise_managed'
    AND o.deleted_at IS NULL;

  -- Check if limit would be exceeded
  IF v_current_count >= v_sub_org_quantity THEN
    RAISE EXCEPTION 'Organization limit reached for enterprise. Current: %, Limit: %',
      v_current_count, v_sub_org_quantity
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- =====================================================
-- Part 2: Create Trigger
-- =====================================================

DROP TRIGGER IF EXISTS enforce_enterprise_org_limit_trigger ON public.organizations;

CREATE TRIGGER enforce_enterprise_org_limit_trigger
  BEFORE INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_enterprise_org_limit();

-- =====================================================
-- Part 3: Documentation
-- =====================================================

COMMENT ON FUNCTION public.enforce_enterprise_org_limit() IS
  'Defense-in-depth trigger function that enforces organization limits for enterprises '
  'using per_sub_org pricing model. Prevents inserting new organizations when the '
  'enterprise has reached its sub_org_quantity limit.';
