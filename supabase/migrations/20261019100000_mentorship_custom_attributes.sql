-- Add custom_attributes jsonb column to mentor_profiles for org-defined
-- matching criteria (sport, major, interests, etc.).
-- Definitions live in organizations.settings.mentorship_custom_attribute_defs.
-- No GIN index — scoring happens in TypeScript, not SQL.

ALTER TABLE mentor_profiles
  ADD COLUMN custom_attributes jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN mentor_profiles.custom_attributes IS
  'Org-defined key-value pairs (e.g., {"sport":"Lacrosse","major":"Business"}).
   Keys are defined in organizations.settings.mentorship_custom_attribute_defs.';
