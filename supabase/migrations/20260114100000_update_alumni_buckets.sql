-- Migration: Update alumni bucket tiers to new pricing structure
-- Old buckets: 'none', '0-200', '201-600', '601-1500', '1500+'
-- New buckets: 'none', '0-250', '251-500', '501-1000', '1001-2500', '2500-5000', '5000+'
--
-- Note: Constraint and data migration were applied directly to production database.
-- This migration documents the changes for version control.

-- Update alumni_bucket_limit function with new bucket values
CREATE OR REPLACE FUNCTION public.alumni_bucket_limit(p_bucket text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_bucket = 'none' OR p_bucket IS NULL THEN 0
    WHEN p_bucket = '0-250' THEN 250
    WHEN p_bucket = '251-500' THEN 500
    WHEN p_bucket = '501-1000' THEN 1000
    WHEN p_bucket = '1001-2500' THEN 2500
    WHEN p_bucket = '2500-5000' THEN 5000
    WHEN p_bucket = '5000+' THEN NULL  -- sales-led, effectively unlimited
    ELSE 0
  END;
$$;

-- Update constraint on organization_subscriptions.alumni_bucket
ALTER TABLE public.organization_subscriptions
  DROP CONSTRAINT IF EXISTS organization_subscriptions_alumni_bucket_check;

ALTER TABLE public.organization_subscriptions
  ADD CONSTRAINT organization_subscriptions_alumni_bucket_check
  CHECK (alumni_bucket IN ('none', '0-250', '251-500', '501-1000', '1001-2500', '2500-5000', '5000+'));

-- Data migration mapping (already applied - documented for reference):
-- '0-200'    -> '0-250'     (same tier level)
-- '201-600'  -> '501-1000'  (covers upper bound)
-- '601-1500' -> '1001-2500' (covers upper bound)
-- '1500+'    -> '5000+'     (unlimited tier)
