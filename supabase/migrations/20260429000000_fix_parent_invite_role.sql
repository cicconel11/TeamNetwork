-- Fix parent invite 400 error caused by migration drift.
-- The 'parent' role and related quota infrastructure were never applied to production.
-- This targeted, idempotent migration adds only what is missing.
-- It supersedes: 20260226000000, 20260608000000, 20260608000001, 20260609000000.

-- ============================================================
-- Step 1: Add 'parent' to user_role enum
-- (needed for user_organization_roles INSERT on invite redemption)
-- ============================================================
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'parent';

-- ============================================================
-- Step 2: Add extra parent columns to public.parents
-- (supersedes 20260608000001 and 20260609000000 ADD COLUMN steps)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'parents'
  ) THEN
    ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS linkedin_url  text;
    ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS student_name  text;
    ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS relationship  text;
    CREATE INDEX IF NOT EXISTS parents_student_name_idx ON public.parents (student_name);
    CREATE INDEX IF NOT EXISTS parents_relationship_idx  ON public.parents (relationship);
  END IF;
END $$;

-- ============================================================
-- Step 3: Add parents_bucket to organization_subscriptions
-- Default '5000+' (unlimited) — parents is a free feature.
-- ============================================================
ALTER TABLE public.organization_subscriptions
  ADD COLUMN IF NOT EXISTS parents_bucket text NOT NULL DEFAULT '5000+'
  CHECK (parents_bucket IN ('none', '0-250', '251-500', '501-1000', '1001-2500', '2500-5000', '5000+'));

-- Ensure any existing 'none' rows default to unlimited
UPDATE public.organization_subscriptions
  SET parents_bucket = '5000+'
  WHERE parents_bucket = 'none';

-- ============================================================
-- Step 4: Quota helper functions
-- ============================================================

-- Map bucket string to numeric limit (NULL = unlimited)
CREATE OR REPLACE FUNCTION public.parents_bucket_limit(p_bucket text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_bucket = 'none' OR p_bucket IS NULL THEN 0
    WHEN p_bucket = '0-250'     THEN 250
    WHEN p_bucket = '251-500'   THEN 500
    WHEN p_bucket = '501-1000'  THEN 1000
    WHEN p_bucket = '1001-2500' THEN 2500
    WHEN p_bucket = '2500-5000' THEN 5000
    WHEN p_bucket = '5000+'     THEN NULL  -- unlimited
    ELSE 0
  END;
$$;

-- Boolean quota check — parents are unlimited, always returns true
CREATE OR REPLACE FUNCTION public.can_add_parents(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT true;
$$;

-- No-op: parents have no quota
CREATE OR REPLACE FUNCTION public.assert_parents_quota(p_org_id uuid)
RETURNS void
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT; -- no-op: parents have no quota
$$;

REVOKE EXECUTE ON FUNCTION public.can_add_parents(uuid)      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_parents_quota(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.can_add_parents(uuid)      TO authenticated;

-- ============================================================
-- Step 4b: Update organization_invites role check constraint
-- Add 'parent' to the allowed roles. Original constraint defined
-- in 20251222215500_fix_invite_role_check.sql only had 3 roles.
-- ============================================================
ALTER TABLE public.organization_invites
DROP CONSTRAINT IF EXISTS organization_invites_role_check;

ALTER TABLE public.organization_invites
ADD CONSTRAINT organization_invites_role_check
CHECK (role IN ('admin', 'active_member', 'alumni', 'parent'));

-- ============================================================
-- Step 5: Replace create_org_invite to accept 'parent' role
-- Preserves all existing logic; adds parent to validation + quota check.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_org_invite(
  p_organization_id uuid,
  p_role            text DEFAULT 'active_member',
  p_uses            int  DEFAULT NULL,
  p_expires_at      timestamptz DEFAULT NULL
)
RETURNS public.organization_invites
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_code   text;
  v_token  text;
  v_result public.organization_invites;
BEGIN
  -- Verify caller is admin of the organization
  IF NOT public.is_org_admin(p_organization_id) THEN
    RAISE EXCEPTION 'Only organization admins can create invites';
  END IF;

  -- Validate role
  IF p_role NOT IN ('admin', 'active_member', 'alumni', 'parent') THEN
    RAISE EXCEPTION 'Invalid role. Must be admin, active_member, alumni, or parent';
  END IF;

  -- Respect alumni quota for alumni invites
  IF p_role = 'alumni' THEN
    PERFORM public.assert_alumni_quota(p_organization_id);
  END IF;

  -- No quota check for parent — parents are unlimited

  -- Generate secure random code (8 chars, alphanumeric)
  v_code := upper(substr(
    replace(replace(replace(
      encode(gen_random_bytes(6), 'base64'),
      '/', ''), '+', ''), '=', ''),
    1, 8
  ));

  -- Generate secure token (URL-safe base64, 32 chars)
  v_token := replace(replace(replace(
    encode(gen_random_bytes(24), 'base64'),
    '/', '_'), '+', '-'), '=', '');

  INSERT INTO public.organization_invites (
    organization_id,
    code,
    token,
    role,
    uses_remaining,
    expires_at,
    created_by_user_id
  ) VALUES (
    p_organization_id,
    v_code,
    v_token,
    p_role,
    p_uses,
    p_expires_at,
    auth.uid()
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================================
-- Step 6: Update get_subscription_status to expose parents_bucket
-- ============================================================
DROP FUNCTION IF EXISTS public.get_subscription_status(uuid);

CREATE FUNCTION public.get_subscription_status(p_org_id uuid)
RETURNS TABLE (
  status               text,
  grace_period_ends_at timestamptz,
  current_period_end   timestamptz,
  alumni_bucket        text,
  parents_bucket       text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    os.status,
    os.grace_period_ends_at,
    os.current_period_end,
    os.alumni_bucket,
    os.parents_bucket
  FROM public.organization_subscriptions os
  WHERE os.organization_id = p_org_id
    AND public.has_active_role(p_org_id, ARRAY['admin', 'active_member', 'alumni', 'parent'])
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_subscription_status(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_subscription_status(uuid) TO authenticated;
