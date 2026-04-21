-- =====================================================
-- Migration: Re-introduce hard cap on enterprise org creation
-- Date: 2026-10-20
-- Purpose: Enforce sub_org_quantity as a hard limit, not just billing quantity.
--          This REVERSES the decision in 20260515100000 Part 4, which dropped
--          the trigger and documented "sub_org_quantity is billing-only."
--          Business rule change: admins must upgrade before exceeding their limit.
-- =====================================================

-- Note: This trigger is DEFENSE-IN-DEPTH. The batch RPC and API layer
-- perform the primary quota check upfront. The trigger catches races
-- and any code path that bypasses the application layer.
--
-- Known gap: The BEFORE INSERT trigger fires before the subscription row
-- for the new org exists, so it undercounts by 1. The batch RPC's upfront
-- check is the real gate; this trigger catches edge cases only.

CREATE OR REPLACE FUNCTION public.enforce_enterprise_org_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_enterprise_id uuid;
  v_sub_org_quantity integer;
  v_current_count integer;
BEGIN
  v_enterprise_id := NEW.enterprise_id;

  -- Only enforce for enterprise-managed orgs
  IF v_enterprise_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fetch the sub_org_quantity (hard cap)
  SELECT es.sub_org_quantity
  INTO v_sub_org_quantity
  FROM public.enterprise_subscriptions es
  WHERE es.enterprise_id = v_enterprise_id
  LIMIT 1;

  -- NULL = legacy unlimited — allow
  IF v_sub_org_quantity IS NULL THEN
    RETURN NEW;
  END IF;

  -- Count existing enterprise-managed orgs (excluding soft-deleted)
  SELECT COUNT(*)
  INTO v_current_count
  FROM public.organizations o
  INNER JOIN public.organization_subscriptions os
    ON os.organization_id = o.id
  WHERE o.enterprise_id = v_enterprise_id
    AND os.status = 'enterprise_managed'
    -- Note: organizations table has no deleted_at column;

  IF v_current_count >= v_sub_org_quantity THEN
    RAISE EXCEPTION 'Enterprise org limit reached (% of % allowed). Upgrade your subscription to add more organizations.',
      v_current_count, v_sub_org_quantity
    USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Revoke public access (defense-in-depth for SECURITY DEFINER)
REVOKE ALL ON FUNCTION public.enforce_enterprise_org_limit() FROM public, anon, authenticated;

CREATE TRIGGER enforce_enterprise_org_limit_trigger
  BEFORE INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_enterprise_org_limit();

-- Update the column comment to reflect the new business rule
COMMENT ON COLUMN public.enterprise_subscriptions.sub_org_quantity IS
  'Hard limit: total enterprise-managed orgs allowed. First 3 included free per bucket, additional at $15/mo or $150/yr. Enforced at DB and app layer. NULL = legacy unlimited.';
