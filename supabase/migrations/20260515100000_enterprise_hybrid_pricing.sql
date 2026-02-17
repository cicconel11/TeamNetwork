-- =====================================================
-- Migration: Enterprise Hybrid Pricing
-- Date: 2026-05-15
-- Purpose: Replace legacy tier/pricing_model with alumni_bucket_quantity
--          for hybrid pricing model (alumni buckets + team add-ons)
-- =====================================================

-- =====================================================
-- Part 1: Add alumni_bucket_quantity column
-- =====================================================

-- Add the new column with a CHECK constraint ensuring >= 1
-- Default to 1 (covers 0-2,500 alumni) for existing rows
ALTER TABLE public.enterprise_subscriptions
  ADD COLUMN IF NOT EXISTS alumni_bucket_quantity integer NOT NULL DEFAULT 1
  CHECK (alumni_bucket_quantity >= 1);

-- =====================================================
-- Part 2: Backfill alumni_bucket_quantity from legacy alumni_tier
-- =====================================================

-- Map legacy tiers to bucket quantities before dropping the column:
--   tier_1 (5,000 alumni)    → 2 buckets (2 × 2,500)
--   tier_2 (10,000 alumni)   → 4 buckets (4 × 2,500)
--   tier_3 (unlimited/sales) → 999 buckets (sentinel for sales-managed/legacy unlimited)
--   NULL / default           → 1 bucket (already set by DEFAULT 1)
UPDATE public.enterprise_subscriptions
SET alumni_bucket_quantity = CASE
  WHEN alumni_tier = 'tier_1' THEN 2
  WHEN alumni_tier = 'tier_2' THEN 4
  WHEN alumni_tier = 'tier_3' THEN 999
  ELSE 1
END
WHERE alumni_tier IS NOT NULL;

-- =====================================================
-- Part 3: Drop legacy columns
-- =====================================================

-- Drop pricing_model column and its index (no longer needed — all enterprises use hybrid model)
DROP INDEX IF EXISTS enterprise_subscriptions_pricing_model_idx;

ALTER TABLE public.enterprise_subscriptions
  DROP COLUMN IF EXISTS pricing_model;

-- Drop alumni_tier and its CHECK constraint
-- The constraint is inline so dropping the column removes it
ALTER TABLE public.enterprise_subscriptions
  DROP COLUMN IF EXISTS alumni_tier;

-- Drop pooled_alumni_limit (replaced by alumni_bucket_quantity * 2500)
ALTER TABLE public.enterprise_subscriptions
  DROP COLUMN IF EXISTS pooled_alumni_limit;

-- Drop custom_price_cents (no custom pricing in new model)
ALTER TABLE public.enterprise_subscriptions
  DROP COLUMN IF EXISTS custom_price_cents;

-- Drop price_per_sub_org_cents (now uses constants from code)
ALTER TABLE public.enterprise_subscriptions
  DROP COLUMN IF EXISTS price_per_sub_org_cents;

-- =====================================================
-- Part 4: Drop enforce_enterprise_org_limit() trigger and function
-- =====================================================

-- The hybrid pricing model treats sub_org_quantity as a billing quantity only
-- (first 3 free, $15/mo per additional). There is no hard cap on org creation.
-- The previous trigger enforced a hard cap via sub_org_quantity, which contradicts
-- the app layer (canEnterpriseAddSubOrg always returns allowed=true).
-- Dropping to prevent silent runtime failures when the app allows but the DB blocks.
DROP TRIGGER IF EXISTS enforce_enterprise_org_limit_trigger ON public.organizations;
DROP TRIGGER IF EXISTS enforce_enterprise_org_limit ON public.organizations;
DROP FUNCTION IF EXISTS public.enforce_enterprise_org_limit();

-- =====================================================
-- Part 5: Update can_enterprise_add_alumni() function
-- =====================================================

-- Rewrite to use alumni_bucket_quantity instead of tier-based limits
CREATE OR REPLACE FUNCTION public.can_enterprise_add_alumni(p_enterprise_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_bucket_qty integer;
  v_limit integer;
  v_count integer;
  v_status text;
BEGIN
  -- Get enterprise subscription details
  SELECT alumni_bucket_quantity, status
  INTO v_bucket_qty, v_status
  FROM public.enterprise_subscriptions
  WHERE enterprise_id = p_enterprise_id
  LIMIT 1;

  -- If no subscription or not active, deny
  IF v_bucket_qty IS NULL OR v_status NOT IN ('active', 'trialing') THEN
    RETURN false;
  END IF;

  -- Each bucket covers 2,500 alumni
  v_limit := v_bucket_qty * 2500;

  -- Get current alumni count across all sub-orgs
  SELECT COALESCE(total_alumni_count, 0)
  INTO v_count
  FROM public.enterprise_alumni_counts
  WHERE enterprise_id = p_enterprise_id;

  RETURN v_count < v_limit;
END;
$$;

-- =====================================================
-- Part 6: Update test enterprise seed data
-- =====================================================

-- Update the test enterprise to use the new column
-- alumni_bucket_quantity = 2 covers up to 5,000 alumni
UPDATE public.enterprise_subscriptions
SET alumni_bucket_quantity = 2
WHERE enterprise_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- =====================================================
-- Part 7: Column Documentation
-- =====================================================

COMMENT ON COLUMN public.enterprise_subscriptions.alumni_bucket_quantity IS
  'Number of alumni buckets purchased (each bucket covers 2,500 alumni). Minimum 1. Buckets 1-4 are self-serve, 5+ requires sales.';

COMMENT ON COLUMN public.enterprise_subscriptions.sub_org_quantity IS
  'Billing quantity: total enterprise-managed orgs. First 3 included free, additional at $15/mo or $150/yr each. Not a hard cap — org creation is always allowed.';

-- =====================================================
-- Part 8: Backfill sub_org_quantity for legacy enterprises
-- =====================================================
-- sub_org_quantity was added with DEFAULT NULL in 20260202100000.
-- NULL breaks the "Add Organization" button in BillingClient (handleAddSeats
-- checks `if (!currentQuantity)` which is truthy for null).
-- Backfill: GREATEST(3, actual enterprise-managed org count).
-- 3 = free tier baseline; actual count prevents billing mismatches.

UPDATE public.enterprise_subscriptions es
SET sub_org_quantity = GREATEST(3, (
  SELECT COUNT(*)::integer
  FROM public.organizations o
  WHERE o.enterprise_id = es.enterprise_id
    AND o.enterprise_relationship_type = 'created'
    AND o.deleted_at IS NULL
))
WHERE es.sub_org_quantity IS NULL;
