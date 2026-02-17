-- Add recurrence support to events table
-- Recurring events are pre-expanded: each instance is a separate row
-- linked by a shared recurrence_group_id.

ALTER TABLE events
  ADD COLUMN recurrence_group_id UUID,
  ADD COLUMN recurrence_index INTEGER,
  ADD COLUMN recurrence_rule JSONB;

-- recurrence_rule schema (stored on parent only, index=0):
-- {
--   "occurrence_type": "daily" | "weekly" | "monthly",
--   "day_of_week": [0-6],        -- weekly only (0=Sunday)
--   "day_of_month": 1-31,        -- monthly only
--   "recurrence_end_date": "YYYY-MM-DD"  -- optional
-- }

COMMENT ON COLUMN events.recurrence_group_id IS 'Links all instances in a recurring series (NULL for one-off events)';
COMMENT ON COLUMN events.recurrence_index IS '0-based position in series (0 = parent/first instance)';
COMMENT ON COLUMN events.recurrence_rule IS 'Recurrence pattern, stored only on parent (index=0)';

-- Index for fetching all events in a series
CREATE INDEX idx_events_recurrence_group ON events (recurrence_group_id)
  WHERE recurrence_group_id IS NOT NULL;

-- Partial index for quick parent lookups
CREATE INDEX idx_events_recurrence_parent ON events (recurrence_group_id)
  WHERE recurrence_group_id IS NOT NULL AND recurrence_index = 0;

-- CHECK: recurrence_rule only allowed on parent (index=0)
ALTER TABLE events
  ADD CONSTRAINT chk_recurrence_rule_on_parent
  CHECK (recurrence_rule IS NULL OR recurrence_index = 0);

-- CHECK: recurrence_group_id and recurrence_index must both be null or both non-null
ALTER TABLE events
  ADD CONSTRAINT chk_recurrence_fields_consistency
  CHECK (
    (recurrence_group_id IS NULL AND recurrence_index IS NULL)
    OR (recurrence_group_id IS NOT NULL AND recurrence_index IS NOT NULL)
  );
