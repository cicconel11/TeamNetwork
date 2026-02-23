-- Migration: add alumni_bucket_quantity to enterprise_subscriptions
--
-- The billing/adjust route explicitly SELECTs and writes alumni_bucket_quantity
-- but this column never existed in the table. Without it every alumni bucket
-- upgrade request fails with 500 (Postgres "column does not exist" error).
--
-- Default 1 so existing rows are valid immediately after the migration.

ALTER TABLE enterprise_subscriptions
  ADD COLUMN IF NOT EXISTS alumni_bucket_quantity integer NOT NULL DEFAULT 1;
