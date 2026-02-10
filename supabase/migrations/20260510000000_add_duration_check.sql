-- Add CHECK constraint for duration_ms on usage_events table.
-- The Zod schema validates non-negative at the API level, but the DB should
-- enforce it too for defense-in-depth (consistent with existing CHECK
-- constraints on hour_of_day and device_class).
ALTER TABLE usage_events
  ADD CONSTRAINT valid_duration CHECK (duration_ms IS NULL OR duration_ms >= 0);
