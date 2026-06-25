-- Alumni re-invite tracking (Phase 2: Unclaimed-Alumni Cohort Console).
--
-- The cohort console lets an admin re-invite unclaimed alumni (user_id IS NULL
-- with an email on file). Invite cadence is bounded by a durable per-alumnus
-- cooldown — the DB column below is the real gate; the in-memory checkRateLimit
-- is only per-instance burst protection.
--
-- No backfill: organization_invites carries no per-recipient email, so there is
-- no way to reconstruct a true last-invite timestamp for existing rows. Leaving
-- last_invite_sent_at NULL lets the first re-invite proceed immediately rather
-- than inventing a false cooldown.

ALTER TABLE public.alumni
  ADD COLUMN IF NOT EXISTS last_invite_sent_at timestamptz NULL;

ALTER TABLE public.alumni
  ADD COLUMN IF NOT EXISTS invite_count integer NOT NULL DEFAULT 0;

-- The console scans the unclaimed cohort (the re-invite target) per org; this
-- partial index keeps that scan off the full alumni table.
CREATE INDEX IF NOT EXISTS alumni_unclaimed_idx
  ON public.alumni (organization_id)
  WHERE deleted_at IS NULL AND user_id IS NULL;
