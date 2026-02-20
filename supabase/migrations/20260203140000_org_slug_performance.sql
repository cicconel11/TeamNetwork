-- =====================================================
-- Migration: Optimize Organization Slug Query Performance
-- Date: 2026-02-03
-- =====================================================

BEGIN;

-- =====================================================
-- Part 1: Add Index on organizations.slug
-- =====================================================
-- Ensures fast lookups by slug (used on every org-scoped request)

CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_idx
ON public.organizations(slug);

-- =====================================================
-- Part 2: Combined Org Context RPC
-- =====================================================
-- Single query to get org + membership + subscription status
-- Reduces 3-5 separate queries to 1

CREATE OR REPLACE FUNCTION public.get_org_context_by_slug(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_org record;
  v_user_id uuid;
  v_role text;
  v_status text;
  v_sub record;
BEGIN
  v_user_id := auth.uid();

  -- Get organization by slug
  SELECT id, name, slug, logo_url, primary_color, secondary_color,
         donation_embed_url, nav_config, stripe_connect_account_id
  INTO v_org
  FROM public.organizations
  WHERE slug = p_slug;

  IF v_org IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- Get membership if authenticated
  IF v_user_id IS NOT NULL THEN
    SELECT role, status INTO v_role, v_status
    FROM public.user_organization_roles
    WHERE organization_id = v_org.id
      AND user_id = v_user_id;
  END IF;

  -- Get subscription info
  SELECT status, grace_period_ends_at, current_period_end, alumni_bucket
  INTO v_sub
  FROM public.organization_subscriptions
  WHERE organization_id = v_org.id;

  RETURN jsonb_build_object(
    'found', true,
    'organization', jsonb_build_object(
      'id', v_org.id,
      'name', v_org.name,
      'slug', v_org.slug,
      'logo_url', v_org.logo_url,
      'primary_color', v_org.primary_color,
      'secondary_color', v_org.secondary_color,
      'donation_embed_url', v_org.donation_embed_url,
      'nav_config', v_org.nav_config,
      'stripe_connect_account_id', v_org.stripe_connect_account_id
    ),
    'membership', CASE WHEN v_role IS NOT NULL THEN jsonb_build_object(
      'role', v_role,
      'status', v_status
    ) ELSE NULL END,
    'subscription', CASE WHEN v_sub IS NOT NULL THEN jsonb_build_object(
      'status', v_sub.status,
      'grace_period_ends_at', v_sub.grace_period_ends_at,
      'current_period_end', v_sub.current_period_end,
      'alumni_bucket', v_sub.alumni_bucket
    ) ELSE NULL END
  );
END;
$$;

-- Grant execute to both authenticated and anon (for public org pages)
GRANT EXECUTE ON FUNCTION public.get_org_context_by_slug(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_context_by_slug(text) TO anon;

COMMIT;
