-- =====================================================
-- Migration: Enterprise Invite Hardening
-- Date: 2026-10-12
-- Purpose: Consolidate three earlier fixes that predate the current migration head:
--   1. Add idempotent CHECK constraints for data integrity
--   2. Reinstate advisory lock in create_enterprise_invite
--   3. Add performance indexes for common queries
-- =====================================================

-- =====================================================
-- Part 1: Idempotent CHECK Constraints
-- =====================================================
-- These constraints prevent uses_remaining from going negative and
-- prevent invalid enterprise-wide + active_member combinations.
-- Wrapped in DO blocks for idempotency on DBs where April migration already ran.

DO $$
BEGIN
  ALTER TABLE public.enterprise_invites
    ADD CONSTRAINT enterprise_invites_uses_remaining_non_negative
    CHECK (uses_remaining IS NULL OR uses_remaining >= 0);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE public.enterprise_invites
    ADD CONSTRAINT enterprise_invites_no_enterprise_wide_active_member
    CHECK (organization_id IS NOT NULL OR role != 'active_member');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END
$$;

-- =====================================================
-- Part 2: Reinstate Advisory Lock in create_enterprise_invite
-- =====================================================
-- This function was defined in 20260413110000 but needs to be present
-- on all databases. CREATE OR REPLACE is inherently idempotent.
-- The advisory lock (line 69) serializes concurrent invite creation,
-- preventing race conditions on admin cap and alumni quota checks.

CREATE OR REPLACE FUNCTION public.create_enterprise_invite(
  p_enterprise_id uuid,
  p_organization_id uuid DEFAULT NULL,
  p_role text DEFAULT 'active_member',
  p_uses integer DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS public.enterprise_invites
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code text;
  v_token text;
  v_invite public.enterprise_invites;
  v_user_id uuid;
  v_admin_count integer;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated';
  END IF;

  -- Verify user is enterprise admin
  IF NOT EXISTS (
    SELECT 1 FROM public.user_enterprise_roles
    WHERE enterprise_id = p_enterprise_id
      AND user_id = v_user_id
      AND role IN ('owner', 'org_admin')
  ) THEN
    RAISE EXCEPTION 'Only enterprise owners and org_admins can create invites';
  END IF;

  -- If organization_id is provided, verify it belongs to this enterprise
  IF p_organization_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.organizations
      WHERE id = p_organization_id
        AND enterprise_id = p_enterprise_id
    ) THEN
      RAISE EXCEPTION 'Organization does not belong to this enterprise';
    END IF;
  END IF;

  -- Validate role
  IF p_role NOT IN ('admin', 'active_member', 'alumni') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  -- Enterprise-wide invites cannot use active_member role
  IF p_organization_id IS NULL AND p_role = 'active_member' THEN
    RAISE EXCEPTION 'Enterprise-wide invites require a specific role (admin or alumni). Members must join a specific organization.';
  END IF;

  -- Serialize concurrent invite creation per enterprise to prevent race conditions
  -- on admin cap and alumni quota checks. This lock is released automatically at
  -- transaction end and ensures atomicity of count-check + insert operations.
  -- Placed after auth/authz checks to avoid contention from unauthorized callers.
  PERFORM pg_advisory_xact_lock(hashtext(p_enterprise_id::text));

  -- Enforce enterprise admin cap (12 max across all orgs)
  IF p_role = 'admin' THEN
    SELECT count(*) INTO v_admin_count
    FROM public.user_organization_roles uor
    JOIN public.organizations o ON o.id = uor.organization_id
    WHERE o.enterprise_id = p_enterprise_id
      AND uor.role = 'admin'
      AND uor.status = 'active';

    IF v_admin_count >= 12 THEN
      RAISE EXCEPTION 'Enterprise admin limit reached (maximum 12 admins across all organizations)';
    END IF;
  END IF;

  -- Respect alumni quota for alumni invites (only when org is specified)
  IF p_role = 'alumni' AND p_organization_id IS NOT NULL THEN
    PERFORM public.assert_alumni_quota(p_organization_id);
  END IF;

  -- Generate secure code (8 chars, alphanumeric, no confusing chars)
  v_code := upper(substring(
    replace(replace(replace(encode(extensions.gen_random_bytes(6), 'base64'), '/', ''), '+', ''), '=', '')
    FROM 1 FOR 8
  ));

  -- Generate secure token (32 chars)
  v_token := encode(extensions.gen_random_bytes(24), 'base64');
  v_token := replace(replace(replace(v_token, '/', ''), '+', ''), '=', '');
  v_token := substring(v_token FROM 1 FOR 32);

  -- Insert the invite
  INSERT INTO public.enterprise_invites (
    enterprise_id,
    organization_id,
    code,
    token,
    role,
    uses_remaining,
    expires_at,
    created_by_user_id
  ) VALUES (
    p_enterprise_id,
    p_organization_id,
    v_code,
    v_token,
    p_role,
    p_uses,
    p_expires_at,
    v_user_id
  )
  RETURNING * INTO v_invite;

  RETURN v_invite;
END;
$$;

-- =====================================================
-- Part 3: Performance Indexes
-- =====================================================
-- IF NOT EXISTS makes these idempotent.

-- Index for redeem_enterprise_invite's code lookup (common path)
CREATE INDEX IF NOT EXISTS idx_enterprise_invites_code_active
  ON public.enterprise_invites(code)
  WHERE revoked_at IS NULL;

-- Index for admin cap pre-check and GET endpoint's admin count query
CREATE INDEX IF NOT EXISTS idx_uor_org_role_status_active
  ON public.user_organization_roles(organization_id, role, status)
  WHERE status = 'active';
