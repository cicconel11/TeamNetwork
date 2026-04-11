-- Add per-org toggle to gate invite redemptions behind admin approval.
-- DEFAULT false preserves current auto-approve behavior for all existing orgs.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS require_invite_approval boolean NOT NULL DEFAULT false;
