-- =====================================================
-- Migration: Extend get_org_context_by_slug with language fields
-- Date: 2026-03-29
-- Purpose: Return default_language in org JSON and
--          language_override in membership JSON so
--          middleware can set the NEXT_LOCALE cookie
--          without extra DB queries.
-- =====================================================

BEGIN;

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
  v_language_override text;
  v_sub record;
BEGIN
  v_user_id := auth.uid();

  -- Get organization by slug (now includes default_language)
  SELECT id, name, slug, logo_url, primary_color, secondary_color,
         donation_embed_url, nav_config, stripe_connect_account_id,
         default_language
  INTO v_org
  FROM public.organizations
  WHERE slug = p_slug;

  IF v_org IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- Get membership and language override in one go
  IF v_user_id IS NOT NULL THEN
    SELECT uor.role, uor.status, u.language_override
    INTO v_role, v_status, v_language_override
    FROM public.user_organization_roles uor
    JOIN public.users u ON u.id = uor.user_id
    WHERE uor.organization_id = v_org.id
      AND uor.user_id = v_user_id;
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
      'stripe_connect_account_id', v_org.stripe_connect_account_id,
      'default_language', v_org.default_language
    ),
    'membership', CASE WHEN v_role IS NOT NULL THEN jsonb_build_object(
      'role', v_role,
      'status', v_status,
      'language_override', v_language_override
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

-- Preserve grants (defensive — CREATE OR REPLACE keeps them, but explicit is safer)
GRANT EXECUTE ON FUNCTION public.get_org_context_by_slug(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_context_by_slug(text) TO anon;

COMMIT;
