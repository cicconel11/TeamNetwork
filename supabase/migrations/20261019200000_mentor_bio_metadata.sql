-- Add metadata columns for AI-generated mentor bios.
-- bio_source tracks whether the bio was manually written or AI-generated.
-- Backfill never overwrites manually-written bios.

ALTER TABLE mentor_profiles
  ADD COLUMN bio_source text CHECK (bio_source IN ('manual', 'ai_generated')),
  ADD COLUMN bio_generated_at timestamptz,
  ADD COLUMN bio_input_hash text;

COMMENT ON COLUMN mentor_profiles.bio_source IS
  'Track whether bio was manually written or AI-generated. Backfill skips manual bios.';

COMMENT ON COLUMN mentor_profiles.bio_generated_at IS
  'Timestamp of the last AI bio generation. Used for staleness checks.';

COMMENT ON COLUMN mentor_profiles.bio_input_hash IS
  'Hash of the input data used for bio generation. Enables idempotent backfill.';
