-- Phase 2 (B1): Track user consent to Terms of Service and Privacy Policy
--
-- Every new user must explicitly accept the current ToS and Privacy Policy.
-- Email signups accept via checkbox; OAuth signups accept via interstitial page.

CREATE TYPE public.agreement_type AS ENUM ('terms_of_service', 'privacy_policy');

CREATE TABLE public.user_agreements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agreement_type public.agreement_type NOT NULL,
  version        TEXT NOT NULL,
  accepted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_hash        TEXT,
  UNIQUE(user_id, agreement_type, version)
);

CREATE INDEX user_agreements_user_idx ON public.user_agreements(user_id);

-- RLS: users can read their own agreements, service role writes
ALTER TABLE public.user_agreements ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_agreements_select ON public.user_agreements
  FOR SELECT TO authenticated USING (user_id = auth.uid());
