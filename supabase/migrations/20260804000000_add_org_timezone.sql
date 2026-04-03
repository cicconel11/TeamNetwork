ALTER TABLE organizations ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/New_York';
