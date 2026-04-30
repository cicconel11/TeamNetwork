-- Pricing v2: discriminator + snapshot columns on subscription tables.
--
-- v1 and v2 subscriptions coexist. Existing rows backfill to 'v1'. New v2
-- signups (org_v2 / enterprise_v2 webhook branches) write 'v2' plus the
-- pure quote() inputs + breakdown so we can audit, reprice, or migrate
-- later without parsing Stripe metadata.

ALTER TABLE organization_subscriptions
  ADD COLUMN IF NOT EXISTS pricing_model_version text NOT NULL DEFAULT 'v1'
    CHECK (pricing_model_version IN ('v1', 'v2')),
  ADD COLUMN IF NOT EXISTS pricing_v2_snapshot jsonb;

ALTER TABLE enterprise_subscriptions
  ADD COLUMN IF NOT EXISTS pricing_model_version text NOT NULL DEFAULT 'v1'
    CHECK (pricing_model_version IN ('v1', 'v2')),
  ADD COLUMN IF NOT EXISTS pricing_v2_snapshot jsonb;

-- Backfill is implicit via DEFAULT 'v1'. No-op for already-existing rows
-- because PostgreSQL fills the new column with the default value at ALTER time.

COMMENT ON COLUMN organization_subscriptions.pricing_model_version IS 'v1 = legacy bucket pricing; v2 = per-user slab pricing.';
COMMENT ON COLUMN organization_subscriptions.pricing_v2_snapshot IS 'Snapshot of v2 quote() inputs + breakdown at subscription creation. Null for v1 rows.';
COMMENT ON COLUMN enterprise_subscriptions.pricing_model_version IS 'v1 = legacy bucket pricing; v2 = per-user slab pricing.';
COMMENT ON COLUMN enterprise_subscriptions.pricing_v2_snapshot IS 'Snapshot of v2 quote() inputs + breakdown at subscription creation. Null for v1 rows.';
