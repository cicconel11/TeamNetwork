-- =====================================================
-- Migration: Enterprise Deletion Requests
-- Date: 2026-12-10
-- Purpose: Persist 30-day soft-delete grace state for enterprises.
--          Mirrors user_deletion_requests + /api/cron/account-deletion.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.enterprise_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL UNIQUE REFERENCES public.enterprises(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  scheduled_deletion_at timestamptz NOT NULL,
  cancelled_at timestamptz,
  completed_at timestamptz
);

-- Partial index for daily cron pickup of due, still-pending requests.
CREATE INDEX IF NOT EXISTS enterprise_deletion_requests_pending_idx
  ON public.enterprise_deletion_requests (status, scheduled_deletion_at)
  WHERE status = 'pending';

-- Service-role-only access (matches enterprise_subscriptions style).
ALTER TABLE public.enterprise_deletion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS enterprise_deletion_requests_service_only ON public.enterprise_deletion_requests;
CREATE POLICY enterprise_deletion_requests_service_only ON public.enterprise_deletion_requests
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
