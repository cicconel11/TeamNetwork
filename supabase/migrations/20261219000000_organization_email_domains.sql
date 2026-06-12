-- =====================================================
-- Migration: Organization Email Domains
-- Date: 2026-12-19
-- Purpose: Per-org custom email sending domains verified via the
--          Resend Domains API. Verified orgs send org-scoped email
--          from "Org Name <noreply@theirdomain.edu>"; everyone else
--          falls back to the global FROM_EMAIL sender.
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.organization_email_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  domain text NOT NULL,
  resend_domain_id text,
  -- Mirrors the Resend SDK DomainStatus union exactly.
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('not_started', 'pending', 'verified', 'failed', 'partially_verified', 'partially_failed')),
  dns_records jsonb NOT NULL DEFAULT '[]'::jsonb,
  sender_local_part text NOT NULL DEFAULT 'noreply'
    CHECK (sender_local_part ~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$' AND length(sender_local_part) <= 64),
  sender_display_name text CHECK (length(sender_display_name) <= 120),
  last_checked_at timestamptz,
  verified_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One org per domain, case-insensitive: villanova.edu can only back one org.
CREATE UNIQUE INDEX IF NOT EXISTS organization_email_domains_domain_key
  ON public.organization_email_domains (lower(domain));

-- Service-role-only access (matches enterprise_deletion_requests style).
-- DNS verification material is served through admin-gated API routes only.
ALTER TABLE public.organization_email_domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_email_domains_service_only ON public.organization_email_domains;
CREATE POLICY organization_email_domains_service_only ON public.organization_email_domains
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMIT;
