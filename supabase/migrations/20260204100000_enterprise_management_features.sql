-- =====================================================
-- Migration: Enterprise Management Features
-- Date: 2026-02-04
-- Purpose: Add nav config, invites, and alumni directory support for enterprises
-- =====================================================

-- =====================================================
-- Part 1: Enterprise Nav Config Columns
-- =====================================================

-- Add nav_config and nav_locked_items to enterprises table
ALTER TABLE public.enterprises
  ADD COLUMN IF NOT EXISTS nav_config jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS nav_locked_items text[] DEFAULT '{}';

-- Add enterprise_nav_synced_at to organizations for tracking sync state
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS enterprise_nav_synced_at timestamptz;

COMMENT ON COLUMN public.enterprises.nav_config IS 'Enterprise-wide navigation configuration that can be synced to sub-organizations';
COMMENT ON COLUMN public.enterprises.nav_locked_items IS 'Array of nav item paths that sub-orgs cannot override (e.g., ["/chat", "/events"])';
COMMENT ON COLUMN public.organizations.enterprise_nav_synced_at IS 'Timestamp of last nav config sync from parent enterprise';

-- =====================================================
-- Part 2: Enterprise Invites Table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.enterprise_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES public.enterprises(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  token text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('admin', 'active_member', 'alumni')),
  uses_remaining integer,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for enterprise invites
CREATE INDEX IF NOT EXISTS enterprise_invites_enterprise_idx
  ON public.enterprise_invites(enterprise_id);
CREATE INDEX IF NOT EXISTS enterprise_invites_organization_idx
  ON public.enterprise_invites(organization_id);
CREATE INDEX IF NOT EXISTS enterprise_invites_token_idx
  ON public.enterprise_invites(token);
CREATE INDEX IF NOT EXISTS enterprise_invites_code_idx
  ON public.enterprise_invites(code);

COMMENT ON TABLE public.enterprise_invites IS 'Invites created by enterprise admins for sub-organizations';
COMMENT ON COLUMN public.enterprise_invites.role IS 'Role to assign when invite is redeemed: admin, active_member, or alumni';
COMMENT ON COLUMN public.enterprise_invites.uses_remaining IS 'Number of uses left, null means unlimited';

-- =====================================================
-- Part 3: Enterprise Alumni Directory View
-- =====================================================

-- Create a view for efficient enterprise-wide alumni queries
CREATE OR REPLACE VIEW public.enterprise_alumni_directory AS
SELECT
  a.id,
  a.organization_id,
  a.first_name,
  a.last_name,
  a.email,
  a.graduation_year,
  a.major,
  a.job_title,
  a.photo_url,
  a.linkedin_url,
  a.phone_number,
  a.notes,
  a.industry,
  a.current_company,
  a.current_city,
  a.position_title,
  a.created_at,
  a.updated_at,
  o.name AS organization_name,
  o.slug AS organization_slug,
  o.enterprise_id
FROM public.alumni a
JOIN public.organizations o ON a.organization_id = o.id
WHERE a.deleted_at IS NULL
  AND o.enterprise_id IS NOT NULL;

COMMENT ON VIEW public.enterprise_alumni_directory IS 'Cross-org alumni view for enterprise dashboard with org context';

-- =====================================================
-- Part 4: Composite Index for Enterprise Alumni Filtering
-- =====================================================

-- Index for efficient filtering in enterprise alumni directory
CREATE INDEX IF NOT EXISTS alumni_enterprise_filter_idx
  ON public.alumni (organization_id, graduation_year, industry, current_city)
  WHERE deleted_at IS NULL;

-- =====================================================
-- Part 5: RPC for Creating Enterprise Invites
-- =====================================================

-- Function to create enterprise invite (similar to org invite pattern)
CREATE OR REPLACE FUNCTION public.create_enterprise_invite(
  p_enterprise_id uuid,
  p_organization_id uuid,
  p_role text,
  p_uses integer DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS public.enterprise_invites
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_code text;
  v_token text;
  v_invite public.enterprise_invites;
  v_user_id uuid;
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

  -- Verify organization belongs to this enterprise
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = p_organization_id
      AND enterprise_id = p_enterprise_id
  ) THEN
    RAISE EXCEPTION 'Organization does not belong to this enterprise';
  END IF;

  -- Validate role
  IF p_role NOT IN ('admin', 'active_member', 'alumni') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
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
-- Part 6: RPC for Redeeming Enterprise Invites
-- =====================================================

-- Function to redeem enterprise invite
CREATE OR REPLACE FUNCTION public.redeem_enterprise_invite(p_code_or_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_invite public.enterprise_invites;
  v_user_id uuid;
  v_org_name text;
  v_org_slug text;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated';
  END IF;

  -- Find the invite by code or token
  SELECT * INTO v_invite
  FROM public.enterprise_invites
  WHERE (code = upper(p_code_or_token) OR token = p_code_or_token)
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
    AND (uses_remaining IS NULL OR uses_remaining > 0);

  IF v_invite IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid, expired, or fully used invite code'
    );
  END IF;

  -- Check if user already has a role in this organization
  IF EXISTS (
    SELECT 1 FROM public.user_organization_roles
    WHERE user_id = v_user_id
      AND organization_id = v_invite.organization_id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You already have a role in this organization'
    );
  END IF;

  -- Get org details
  SELECT name, slug INTO v_org_name, v_org_slug
  FROM public.organizations
  WHERE id = v_invite.organization_id;

  -- Create the membership with active status (auto-approved for enterprise invites)
  INSERT INTO public.user_organization_roles (
    user_id,
    organization_id,
    role,
    status
  ) VALUES (
    v_user_id,
    v_invite.organization_id,
    v_invite.role,
    'active'
  );

  -- Decrement uses if applicable
  IF v_invite.uses_remaining IS NOT NULL THEN
    UPDATE public.enterprise_invites
    SET uses_remaining = uses_remaining - 1
    WHERE id = v_invite.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', v_invite.organization_id,
    'organization_name', v_org_name,
    'organization_slug', v_org_slug,
    'role', v_invite.role
  );
END;
$$;

-- =====================================================
-- Part 7: RLS Policies for Enterprise Invites
-- =====================================================

ALTER TABLE public.enterprise_invites ENABLE ROW LEVEL SECURITY;

-- Enterprise admins can view invites for their enterprise
DROP POLICY IF EXISTS enterprise_invites_select ON public.enterprise_invites;
CREATE POLICY enterprise_invites_select ON public.enterprise_invites
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_enterprise_roles
      WHERE enterprise_id = enterprise_invites.enterprise_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'org_admin')
    )
  );

-- Ensure no broad token-based SELECT access (redemption stays in RPC path)
DROP POLICY IF EXISTS enterprise_invites_select_token ON public.enterprise_invites;
-- Redemption is handled only through SECURITY DEFINER RPCs.
-- Do not allow broad token-based row reads, which can leak active invite metadata.

-- Service role can manage all
DROP POLICY IF EXISTS enterprise_invites_service_all ON public.enterprise_invites;
CREATE POLICY enterprise_invites_service_all ON public.enterprise_invites
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- =====================================================
-- Part 8: Grant Permissions
-- =====================================================

GRANT EXECUTE ON FUNCTION public.create_enterprise_invite(uuid, uuid, text, integer, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_enterprise_invite(text) TO authenticated;
GRANT SELECT ON public.enterprise_alumni_directory TO authenticated;

-- =====================================================
-- Part 9: Helper Function for Enterprise Nav Sync
-- =====================================================

-- Function to sync enterprise nav config to a sub-organization
CREATE OR REPLACE FUNCTION public.sync_enterprise_nav_to_org(
  p_enterprise_id uuid,
  p_organization_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_enterprise_nav_config jsonb;
  v_enterprise_locked_items text[];
  v_org_nav_config jsonb;
  v_merged_config jsonb;
  v_locked_item text;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();

  -- Restrict execution to enterprise owners/org admins (service role bypasses this check).
  IF auth.role() <> 'service_role' THEN
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'Must be authenticated';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.user_enterprise_roles
      WHERE enterprise_id = p_enterprise_id
        AND user_id = v_user_id
        AND role IN ('owner', 'org_admin')
    ) THEN
      RAISE EXCEPTION 'Only enterprise owners and org_admins can sync navigation';
    END IF;
  END IF;

  -- Get enterprise nav config
  SELECT nav_config, nav_locked_items
  INTO v_enterprise_nav_config, v_enterprise_locked_items
  FROM public.enterprises
  WHERE id = p_enterprise_id;

  IF v_enterprise_nav_config IS NULL THEN
    v_enterprise_nav_config := '{}'::jsonb;
  END IF;

  -- Get current org nav config
  SELECT nav_config INTO v_org_nav_config
  FROM public.organizations
  WHERE id = p_organization_id
    AND enterprise_id = p_enterprise_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_org_nav_config IS NULL THEN
    v_org_nav_config := '{}'::jsonb;
  END IF;

  -- Start with org config
  v_merged_config := v_org_nav_config;

  -- Override with enterprise config for locked items only
  IF v_enterprise_locked_items IS NOT NULL THEN
    FOREACH v_locked_item IN ARRAY v_enterprise_locked_items
    LOOP
      IF v_enterprise_nav_config ? v_locked_item THEN
        v_merged_config := v_merged_config || jsonb_build_object(
          v_locked_item, v_enterprise_nav_config -> v_locked_item
        );
      END IF;
    END LOOP;
  END IF;

  -- Update org with merged config
  UPDATE public.organizations
  SET nav_config = v_merged_config,
      enterprise_nav_synced_at = now()
  WHERE id = p_organization_id
    AND enterprise_id = p_enterprise_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_enterprise_nav_to_org(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.sync_enterprise_nav_to_org IS 'Syncs enterprise nav config to a sub-org, applying locked items from enterprise';
