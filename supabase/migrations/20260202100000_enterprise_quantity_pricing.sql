-- =====================================================
-- Migration: Enterprise Quantity Pricing
-- Date: 2026-02-02
-- Purpose: Add quantity-based pricing model for enterprise subscriptions
-- =====================================================

-- =====================================================
-- Part 1: Add Pricing Model Columns
-- =====================================================

-- Add pricing_model column to support both legacy tier pricing and per-sub-org pricing
ALTER TABLE public.enterprise_subscriptions
  ADD COLUMN IF NOT EXISTS pricing_model text DEFAULT 'alumni_tier'
  CHECK (pricing_model IN ('alumni_tier', 'per_sub_org'));

-- Add quantity tracking for per-sub-org pricing model
ALTER TABLE public.enterprise_subscriptions
  ADD COLUMN IF NOT EXISTS sub_org_quantity integer DEFAULT NULL;

-- Add configurable price per sub-org seat (default $150.00 = 15000 cents)
ALTER TABLE public.enterprise_subscriptions
  ADD COLUMN IF NOT EXISTS price_per_sub_org_cents integer DEFAULT 15000;

-- =====================================================
-- Part 2: Add Index for Efficient Queries
-- =====================================================

-- Index for filtering subscriptions by pricing model
CREATE INDEX IF NOT EXISTS enterprise_subscriptions_pricing_model_idx
  ON public.enterprise_subscriptions(pricing_model);

-- =====================================================
-- Part 3: Update Enterprise Alumni Counts View
-- =====================================================

-- Replace the view to add enterprise_managed_org_count for seat enforcement
-- Only orgs with enterprise_managed billing status count toward the seat limit
CREATE OR REPLACE VIEW public.enterprise_alumni_counts AS
SELECT
  e.id AS enterprise_id,
  COUNT(DISTINCT CASE WHEN os.status = 'enterprise_managed' THEN a.id END) AS total_alumni_count,
  COUNT(DISTINCT o.id) AS sub_org_count,
  COUNT(DISTINCT CASE WHEN os.status = 'enterprise_managed' THEN o.id END) AS enterprise_managed_org_count
FROM public.enterprises e
LEFT JOIN public.organizations o ON o.enterprise_id = e.id
LEFT JOIN public.organization_subscriptions os ON os.organization_id = o.id
LEFT JOIN public.alumni a ON a.organization_id = o.id AND a.deleted_at IS NULL
GROUP BY e.id;

-- =====================================================
-- Part 4: Column Documentation
-- =====================================================

COMMENT ON COLUMN public.enterprise_subscriptions.pricing_model IS 'alumni_tier = legacy tier pricing, per_sub_org = quantity-based seat pricing';
COMMENT ON COLUMN public.enterprise_subscriptions.sub_org_quantity IS 'Number of enterprise-managed org seats (independent orgs do not count)';
COMMENT ON COLUMN public.enterprise_subscriptions.price_per_sub_org_cents IS 'Price per sub-org seat in cents (default $150.00 = 15000 cents)';
