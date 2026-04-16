-- Add base_color column for 3-color branding system
-- base_color: 'primary' (sidebar color), '#ffffff' (light), or '#222326' (dark)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS base_color VARCHAR(20) DEFAULT 'primary';
