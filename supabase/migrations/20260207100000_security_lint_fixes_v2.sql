-- =====================================================
-- Migration: Fix Supabase Security Linter Issues
-- Date: 2026-02-03
-- Issues: Mutable search_path in functions
-- =====================================================
--
-- This migration fixes security linter warnings for functions
-- that are missing SET search_path = '' or have non-empty search_path.
--
-- Functions fixed (18 total):
-- - is_org_member: missing search_path
-- - is_org_admin: missing search_path
-- - has_active_role: missing search_path
-- - can_edit_page: missing search_path
-- - update_user_deletion_requests_updated_at: missing search_path
-- - handle_new_user: missing search_path
-- - update_updated_at_column: missing search_path
-- - redeem_org_invite: has SET search_path = public, needs ''
-- - redeem_org_invite_by_token: missing search_path
-- - get_dropdown_options: missing search_path
-- - alumni_bucket_limit: missing search_path
-- - get_alumni_quota: missing search_path
-- - can_add_alumni: missing search_path
-- - assert_alumni_quota: missing search_path
-- - handle_org_member_sync: missing search_path
-- - is_chat_group_member: has SET search_path = public, needs ''
-- - is_chat_group_moderator: has SET search_path = public, needs ''
-- - protect_alumni_self_edit: has SET search_path = public, needs ''
--
-- Note: Enterprise-related objects (enterprise_alumni_counts,
-- enterprise_alumni_directory, is_enterprise_admin, etc.) are
-- not included as they are not defined in migrations. If those
-- exist in production, they should be addressed separately.
-- =====================================================

BEGIN;

-- =====================================================
-- Part 1: Fix Organization Helper Functions
-- =====================================================

-- Fix is_org_member - add SET search_path = ''
CREATE OR REPLACE FUNCTION public.is_org_member(org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_organization_roles
    WHERE organization_id = org_id
      AND user_id = auth.uid()
      AND status = 'active'
  );
$$;

-- Fix is_org_admin - add SET search_path = ''
CREATE OR REPLACE FUNCTION public.is_org_admin(org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_organization_roles
    WHERE organization_id = org_id
      AND user_id = auth.uid()
      AND status = 'active'
      AND role = 'admin'
  );
$$;

-- Fix has_active_role - add SET search_path = ''
CREATE OR REPLACE FUNCTION public.has_active_role(org uuid, allowed_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_organization_roles uor
    WHERE uor.organization_id = org
      AND uor.user_id = auth.uid()
      AND uor.status = 'active'
      AND uor.role = ANY(allowed_roles)
  );
$$;

-- Fix can_edit_page - add SET search_path = ''
CREATE OR REPLACE FUNCTION public.can_edit_page(org_id uuid, path text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT
    public.has_active_role(org_id, array['admin'])
    OR EXISTS (
      SELECT 1
      FROM public.organizations o
      CROSS JOIN LATERAL (
        SELECT COALESCE(o.nav_config -> path -> 'editRoles', '["admin"]'::jsonb) AS roles
      ) cfg
      CROSS JOIN LATERAL jsonb_array_elements_text(cfg.roles) AS r(role)
      WHERE o.id = org_id
        AND (
          (r.role = 'admin' AND public.has_active_role(org_id, array['admin']))
          OR (r.role = 'active_member' AND public.has_active_role(org_id, array['active_member']))
          OR (r.role = 'alumni' AND public.has_active_role(org_id, array['alumni']))
        )
    );
$$;

-- =====================================================
-- Part 2: Fix Trigger Functions
-- =====================================================

-- Fix update_user_deletion_requests_updated_at - add SET search_path = ''
CREATE OR REPLACE FUNCTION public.update_user_deletion_requests_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Fix handle_new_user - add SET search_path = ''
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (id, email, name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name'),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, public.users.name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url);
  RETURN NEW;
END;
$$;

-- Fix update_updated_at_column - add SET search_path = ''
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =====================================================
-- Part 3: Fix Invite Functions
-- =====================================================

-- Fix redeem_org_invite - change from 'public, extensions, auth' to ''
-- Preserves the full functionality including revoked user reactivation
CREATE OR REPLACE FUNCTION public.redeem_org_invite(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invite public.organization_invites;
  v_org public.organizations;
  v_existing public.user_organization_roles;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();

  -- Must be authenticated
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'You must be logged in to redeem an invite');
  END IF;

  -- Find invite by code OR token
  SELECT * INTO v_invite
  FROM public.organization_invites
  WHERE (upper(code) = upper(trim(p_code)) OR token = trim(p_code))
    AND revoked_at IS NULL;

  IF v_invite IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid invite code (not found)');
  END IF;

  -- Check if invite has expired
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'This invite has expired');
  END IF;

  -- Check if invite has uses remaining
  IF v_invite.uses_remaining IS NOT NULL AND v_invite.uses_remaining <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'This invite has no uses remaining');
  END IF;

  -- Check if user already has a membership in this org
  SELECT * INTO v_existing
  FROM public.user_organization_roles
  WHERE user_id = v_user_id
    AND organization_id = v_invite.organization_id;

  IF v_existing IS NOT NULL THEN
    SELECT * INTO v_org FROM public.organizations WHERE id = v_invite.organization_id;

    IF v_existing.status = 'revoked' THEN
      -- Reactivate the revoked user, preserving their original role to prevent privilege escalation
      UPDATE public.user_organization_roles
      SET status = 'active'
      WHERE user_id = v_user_id AND organization_id = v_invite.organization_id;

      -- Decrement uses_remaining if it's set
      IF v_invite.uses_remaining IS NOT NULL THEN
        UPDATE public.organization_invites
        SET uses_remaining = uses_remaining - 1
        WHERE id = v_invite.id;
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'organization_id', v_invite.organization_id,
        'slug', v_org.slug,
        'name', v_org.name,
        'role', v_existing.role,
        'pending_approval', false
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'organization_id', v_invite.organization_id,
      'slug', v_org.slug,
      'name', v_org.name,
      'already_member', true,
      'status', v_existing.status
    );
  END IF;

  -- Insert new membership with ACTIVE status (auto-approved via invite code)
  INSERT INTO public.user_organization_roles (user_id, organization_id, role, status)
  VALUES (v_user_id, v_invite.organization_id, v_invite.role::public.user_role, 'active');

  -- Decrement uses_remaining if it's set
  IF v_invite.uses_remaining IS NOT NULL THEN
    UPDATE public.organization_invites
    SET uses_remaining = uses_remaining - 1
    WHERE id = v_invite.id;
  END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = v_invite.organization_id;

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', v_invite.organization_id,
    'slug', v_org.slug,
    'name', v_org.name,
    'role', v_invite.role,
    'pending_approval', false
  );
END;
$$;

-- Fix redeem_org_invite_by_token - add SET search_path = ''
CREATE OR REPLACE FUNCTION public.redeem_org_invite_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.redeem_org_invite(p_token);
END;
$$;

-- =====================================================
-- Part 4: Fix Dropdown Options Function
-- =====================================================

-- Fix get_dropdown_options - add SET search_path = ''
CREATE OR REPLACE FUNCTION public.get_dropdown_options(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  -- Check membership
  IF NOT public.is_org_member(p_org_id) THEN
    RETURN '{}'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'alumni', jsonb_build_object(
      'graduation_years', (
        SELECT COALESCE(jsonb_agg(DISTINCT graduation_year ORDER BY graduation_year DESC), '[]'::jsonb)
        FROM public.alumni
        WHERE organization_id = p_org_id AND deleted_at IS NULL AND graduation_year IS NOT NULL
      ),
      'industries', (
        SELECT COALESCE(jsonb_agg(DISTINCT industry ORDER BY industry), '[]'::jsonb)
        FROM public.alumni
        WHERE organization_id = p_org_id AND deleted_at IS NULL AND industry IS NOT NULL AND industry != ''
      ),
      'companies', (
        SELECT COALESCE(jsonb_agg(DISTINCT current_company ORDER BY current_company), '[]'::jsonb)
        FROM public.alumni
        WHERE organization_id = p_org_id AND deleted_at IS NULL AND current_company IS NOT NULL AND current_company != ''
      ),
      'cities', (
        SELECT COALESCE(jsonb_agg(DISTINCT current_city ORDER BY current_city), '[]'::jsonb)
        FROM public.alumni
        WHERE organization_id = p_org_id AND deleted_at IS NULL AND current_city IS NOT NULL AND current_city != ''
      ),
      'positions', (
        SELECT COALESCE(jsonb_agg(DISTINCT position_title ORDER BY position_title), '[]'::jsonb)
        FROM public.alumni
        WHERE organization_id = p_org_id AND deleted_at IS NULL AND position_title IS NOT NULL AND position_title != ''
      ),
      'majors', (
        SELECT COALESCE(jsonb_agg(DISTINCT major ORDER BY major), '[]'::jsonb)
        FROM public.alumni
        WHERE organization_id = p_org_id AND deleted_at IS NULL AND major IS NOT NULL AND major != ''
      )
    ),
    'members', jsonb_build_object(
      'roles', (
        SELECT COALESCE(jsonb_agg(DISTINCT role ORDER BY role), '[]'::jsonb)
        FROM public.members
        WHERE organization_id = p_org_id AND deleted_at IS NULL AND role IS NOT NULL AND role != ''
      ),
      'graduation_years', (
        SELECT COALESCE(jsonb_agg(DISTINCT graduation_year ORDER BY graduation_year DESC), '[]'::jsonb)
        FROM public.members
        WHERE organization_id = p_org_id AND deleted_at IS NULL AND graduation_year IS NOT NULL
      ),
      'statuses', (
        SELECT COALESCE(jsonb_agg(DISTINCT status ORDER BY status), '[]'::jsonb)
        FROM public.members
        WHERE organization_id = p_org_id AND deleted_at IS NULL AND status IS NOT NULL
      )
    ),
    'events', jsonb_build_object(
      'locations', (
        SELECT COALESCE(jsonb_agg(DISTINCT location ORDER BY location), '[]'::jsonb)
        FROM public.events
        WHERE organization_id = p_org_id AND deleted_at IS NULL AND location IS NOT NULL AND location != ''
      ),
      'types', (
        SELECT COALESCE(jsonb_agg(DISTINCT event_type ORDER BY event_type), '[]'::jsonb)
        FROM public.events
        WHERE organization_id = p_org_id AND deleted_at IS NULL AND event_type IS NOT NULL
      )
    ),
    'donations', jsonb_build_object(
      'campaigns', (
        SELECT COALESCE(jsonb_agg(DISTINCT campaign ORDER BY campaign), '[]'::jsonb)
        FROM public.donations
        WHERE organization_id = p_org_id AND deleted_at IS NULL AND campaign IS NOT NULL AND campaign != ''
      )
    )
  );
END;
$$;

-- =====================================================
-- Part 5: Fix Alumni Quota Functions
-- =====================================================

-- Fix alumni_bucket_limit - add SET search_path = ''
CREATE OR REPLACE FUNCTION public.alumni_bucket_limit(p_bucket text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_bucket = 'none' OR p_bucket IS NULL THEN 0
    WHEN p_bucket = '0-200' THEN 200
    WHEN p_bucket = '201-600' THEN 600
    WHEN p_bucket = '601-1500' THEN 1500
    WHEN p_bucket = '1500+' THEN NULL -- sales-led, effectively unlimited
    ELSE 0
  END;
$$;

-- Fix get_alumni_quota - add SET search_path = ''
CREATE OR REPLACE FUNCTION public.get_alumni_quota(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_bucket text;
  v_limit integer;
  v_count integer;
  v_status text;
BEGIN
  IF NOT public.is_org_admin(p_org_id) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'error', 'Only admins can view alumni quota',
      'bucket', 'none',
      'alumni_limit', 0,
      'alumni_count', 0,
      'remaining', 0
    );
  END IF;

  SELECT alumni_bucket, status
  INTO v_bucket, v_status
  FROM public.organization_subscriptions
  WHERE organization_id = p_org_id
  LIMIT 1;

  v_bucket := COALESCE(v_bucket, 'none');
  v_limit := public.alumni_bucket_limit(v_bucket);

  SELECT COUNT(*) INTO v_count
  FROM public.alumni
  WHERE organization_id = p_org_id
    AND deleted_at IS NULL;

  RETURN jsonb_build_object(
    'allowed', true,
    'bucket', v_bucket,
    'status', COALESCE(v_status, 'pending'),
    'alumni_limit', v_limit,
    'alumni_count', v_count,
    'remaining', CASE WHEN v_limit IS NULL THEN NULL ELSE GREATEST(v_limit - v_count, 0) END
  );
END;
$$;

-- Fix can_add_alumni - add SET search_path = ''
CREATE OR REPLACE FUNCTION public.can_add_alumni(p_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_bucket text;
  v_limit integer;
  v_count integer;
BEGIN
  SELECT COALESCE(alumni_bucket, 'none')
  INTO v_bucket
  FROM public.organization_subscriptions
  WHERE organization_id = p_org_id
  LIMIT 1;

  v_limit := public.alumni_bucket_limit(v_bucket);

  -- No cap for sales-led bucket
  IF v_limit IS NULL THEN
    RETURN true;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.alumni
  WHERE organization_id = p_org_id
    AND deleted_at IS NULL;

  RETURN v_count < v_limit;
END;
$$;

-- Fix assert_alumni_quota - add SET search_path = ''
CREATE OR REPLACE FUNCTION public.assert_alumni_quota(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  IF NOT public.can_add_alumni(p_org_id) THEN
    RAISE EXCEPTION 'Alumni quota reached for this plan. Upgrade your subscription to add more alumni.';
  END IF;
END;
$$;

-- =====================================================
-- Part 6: Fix Member Sync Trigger Function
-- =====================================================

-- Fix handle_org_member_sync - add SET search_path = ''
CREATE OR REPLACE FUNCTION public.handle_org_member_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_email text;
  v_first_name text;
  v_last_name text;
  v_avatar_url text;
  v_member_id uuid;
  v_alumni_id uuid;
BEGIN
  -- Get user details from auth.users
  SELECT
    email,
    COALESCE(raw_user_meta_data->>'first_name', split_part(COALESCE(raw_user_meta_data->>'full_name', 'Member'), ' ', 1)),
    COALESCE(raw_user_meta_data->>'last_name', split_part(COALESCE(raw_user_meta_data->>'full_name', ''), ' ', 2)),
    raw_user_meta_data->>'avatar_url'
  INTO v_user_email, v_first_name, v_last_name, v_avatar_url
  FROM auth.users
  WHERE id = NEW.user_id;

  -- Ensure we have defaults if auth data is missing
  v_first_name := COALESCE(v_first_name, 'Member');
  v_last_name := COALESCE(v_last_name, '');

  -- 1. Sync to public.members
  -- Check if member entry exists for this user+org (by user_id OR email)
  SELECT id INTO v_member_id
  FROM public.members
  WHERE organization_id = NEW.organization_id
    AND (user_id = NEW.user_id OR (email IS NOT NULL AND email = v_user_email))
  LIMIT 1;

  IF v_member_id IS NOT NULL THEN
    -- Update existing member
    UPDATE public.members
    SET
      user_id = NEW.user_id, -- Link user_id if it was missing
      role = NEW.role,
      status = NEW.status::text::public.member_status,
      updated_at = now()
    WHERE id = v_member_id;
  ELSE
    -- Insert new member
    INSERT INTO public.members (
      organization_id,
      user_id,
      first_name,
      last_name,
      email,
      photo_url,
      role,
      status
    )
    VALUES (
      NEW.organization_id,
      NEW.user_id,
      v_first_name,
      v_last_name,
      v_user_email,
      v_avatar_url,
      NEW.role,
      NEW.status::text::public.member_status
    );
  END IF;

  -- 2. Sync to public.alumni if role is ALUMNI
  IF NEW.role = 'alumni' THEN
    SELECT id INTO v_alumni_id
    FROM public.alumni
    WHERE organization_id = NEW.organization_id
      AND (user_id = NEW.user_id OR (email IS NOT NULL AND email = v_user_email))
    LIMIT 1;

    IF v_alumni_id IS NOT NULL THEN
       -- Existing alumni, just link user_id and touch updated_at
       UPDATE public.alumni
       SET
         user_id = NEW.user_id,
         updated_at = now()
       WHERE id = v_alumni_id;
    ELSE
       -- Enforce alumni quota before creating a new profile
       PERFORM public.assert_alumni_quota(NEW.organization_id);

       -- Create alumni profile
       INSERT INTO public.alumni (
         organization_id,
         user_id,
         first_name,
         last_name,
         email,
         photo_url
       )
       VALUES (
         NEW.organization_id,
         NEW.user_id,
         v_first_name,
         v_last_name,
         v_user_email,
         v_avatar_url
       );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- =====================================================
-- Part 7: Fix Chat Functions
-- =====================================================

-- Fix is_chat_group_member - change from 'public' to ''
CREATE OR REPLACE FUNCTION public.is_chat_group_member(group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT TRUE
     FROM public.chat_group_members cgm
     WHERE cgm.chat_group_id = group_id
       AND cgm.user_id = auth.uid()
     LIMIT 1),
    FALSE
  );
$$;

-- Fix is_chat_group_moderator - change from 'public' to ''
CREATE OR REPLACE FUNCTION public.is_chat_group_moderator(group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT TRUE
     FROM public.chat_group_members cgm
     WHERE cgm.chat_group_id = group_id
       AND cgm.user_id = auth.uid()
       AND cgm.role IN ('admin', 'moderator')
     LIMIT 1),
    FALSE
  );
$$;

-- =====================================================
-- Part 8: Fix Alumni Self-Edit Protection Trigger
-- =====================================================

-- Fix protect_alumni_self_edit - change from 'public' to ''
CREATE OR REPLACE FUNCTION public.protect_alumni_self_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Service-role callers bypass all checks (backend sync, backfill jobs)
  IF (SELECT auth.role()) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Only restrict non-page-editors (self-edit pathway)
  IF NOT public.can_edit_page(OLD.organization_id, '/alumni') THEN
    -- user_id: only allow adding a link to yourself (OLD is NULL, NEW is you)
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      IF NOT (OLD.user_id IS NULL AND NEW.user_id = (SELECT auth.uid())) THEN
        RAISE EXCEPTION 'Cannot change user_id on alumni self-edit';
      END IF;
    END IF;
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'Cannot change organization_id on alumni self-edit';
    END IF;
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Only page editors can soft-delete alumni records';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;

-- =====================================================
-- Verification Queries (run after migration)
-- =====================================================
--
-- Verify functions have search_path set:
--
-- SELECT proname, proconfig
-- FROM pg_proc
-- JOIN pg_namespace ON pg_proc.pronamespace = pg_namespace.oid
-- WHERE nspname = 'public'
--   AND proname IN (
--     'is_org_member', 'is_org_admin',
--     'has_active_role', 'can_edit_page',
--     'update_user_deletion_requests_updated_at',
--     'handle_new_user', 'update_updated_at_column',
--     'redeem_org_invite', 'redeem_org_invite_by_token',
--     'get_dropdown_options',
--     'alumni_bucket_limit', 'get_alumni_quota',
--     'can_add_alumni', 'assert_alumni_quota',
--     'handle_org_member_sync',
--     'is_chat_group_member', 'is_chat_group_moderator',
--     'protect_alumni_self_edit'
--   );
--
-- All should show: {search_path=} in proconfig
-- =====================================================

-- =====================================================
-- Manual Step: Enable Leaked Password Protection
-- =====================================================
--
-- 1. Go to Supabase Dashboard
-- 2. Navigate to Authentication → Settings → Password Security
-- 3. Enable "Leaked password protection"
--
-- This checks passwords against HaveIBeenPwned.org to prevent
-- use of compromised passwords.
-- =====================================================

-- =====================================================
-- Note on Enterprise Functions
-- =====================================================
--
-- The following objects from the plan are NOT included because
-- they do not exist in the migration files. If they exist in
-- production (created directly via SQL), they need to be fixed
-- separately or migrations should be created first:
--
-- Views:
-- - enterprise_alumni_counts
-- - enterprise_alumni_directory
--
-- Functions:
-- - is_enterprise_admin
-- - is_enterprise_owner
-- - is_enterprise_member
-- - can_enterprise_add_alumni
-- - is_enterprise_member_via_org
--
-- These would need separate migrations to:
-- 1. Define the enterprise tables (enterprises, user_enterprise_roles, etc.)
-- 2. Create the helper functions with SET search_path = ''
-- 3. Create the views with SECURITY INVOKER
-- 4. Add the enterprise-aware RLS policies
-- =====================================================
