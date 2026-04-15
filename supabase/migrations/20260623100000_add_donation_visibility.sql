-- Add visibility column to organization_donations for privacy controls
ALTER TABLE organization_donations
  ADD COLUMN visibility text NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'supporter_only', 'private'));

-- Backfill: anonymous donations should default to private, not public
UPDATE organization_donations
  SET visibility = 'private'
  WHERE anonymous = true;

-- Index for filtered queries
CREATE INDEX idx_org_donations_visibility
  ON organization_donations (organization_id, visibility)
  WHERE deleted_at IS NULL;
