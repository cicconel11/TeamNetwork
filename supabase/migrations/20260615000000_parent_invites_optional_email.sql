-- Make email nullable on parent_invites.
-- Parent invites are now shareable links (like org invites) — no email required at creation time.
-- The parent supplies their own email when redeeming the invite link.
ALTER TABLE public.parent_invites ALTER COLUMN email DROP NOT NULL;

-- Drop the partial index that enforced org+email+status uniqueness.
-- Email-based idempotency is no longer needed since invites are not email-bound.
DROP INDEX IF EXISTS public.parent_invites_org_email_status_idx;
