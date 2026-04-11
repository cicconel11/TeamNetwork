-- Add leased_at column for atomic lease claim in Stripe event deduplication.
-- On INSERT, leased_at defaults to NOW() (the initial lease).
-- Stale leases (>5 min) can be atomically re-claimed via the claim_stale_stripe_event RPC.

ALTER TABLE stripe_events ADD COLUMN leased_at timestamptz DEFAULT NOW();

-- Backfill existing rows so the lease logic works uniformly
UPDATE stripe_events SET leased_at = created_at WHERE leased_at IS NULL;

-- RPC for atomic stale lease claim (UPDATE ... RETURNING * pattern)
CREATE OR REPLACE FUNCTION claim_stale_stripe_event(p_event_id text)
RETURNS SETOF stripe_events
LANGUAGE sql
AS $$
  UPDATE stripe_events
  SET leased_at = NOW()
  WHERE event_id = p_event_id
    AND processed_at IS NULL
    AND leased_at < NOW() - INTERVAL '5 minutes'
  RETURNING *;
$$;
