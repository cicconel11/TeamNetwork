-- Default lock-screen tracking ON. The original migration (20260508170000)
-- defaulted this column false on the assumption users would discover a
-- per-event toggle. In practice the toggle is buried; "I RSVP'd attending"
-- is a strong-enough signal to surface the Live Activity by default.
-- Existing rows are not backfilled — only future RSVPs pick up the new
-- default. Users can still opt out per event from the event detail screen.
ALTER TABLE public.event_rsvps
  ALTER COLUMN track_on_lock_screen SET DEFAULT true;

COMMENT ON COLUMN public.event_rsvps.track_on_lock_screen IS
  'User opted into Live Activity / lock-screen tracking for this event. Defaults true; users can opt out per event.';
