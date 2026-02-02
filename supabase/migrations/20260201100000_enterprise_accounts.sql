-- =====================================================
-- Migration: Enterprise Accounts
-- Date: 2026-02-01
-- Purpose: Add enterprise account support for multi-org management
-- =====================================================

-- =====================================================
-- Part 1: Enterprise Core Table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.enterprises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  logo_url text,
  primary_color text,
  billing_contact_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create index on slug for lookups
CREATE UNIQUE INDEX IF NOT EXISTS enterprises_slug_idx ON public.enterprises(slug);

-- Enable updated_at trigger
DROP TRIGGER IF EXISTS enterprises_updated_at ON public.enterprises;
CREATE TRIGGER enterprises_updated_at
  BEFORE UPDATE ON public.enterprises
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Part 2: Enterprise Subscriptions Table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.enterprise_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES public.enterprises(id) ON DELETE CASCADE,
  stripe_customer_id text,
  stripe_subscription_id text,
  billing_interval text NOT NULL CHECK (billing_interval IN ('month', 'year')),
  alumni_tier text NOT NULL DEFAULT 'tier_1' CHECK (alumni_tier IN ('tier_1', 'tier_2', 'tier_3', 'custom')),
  pooled_alumni_limit integer,
  custom_price_cents integer,
  status text NOT NULL DEFAULT 'pending',
  current_period_end timestamptz,
  grace_period_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One subscription per enterprise
CREATE UNIQUE INDEX IF NOT EXISTS enterprise_subscriptions_enterprise_idx
  ON public.enterprise_subscriptions(enterprise_id);

-- Enable updated_at trigger
DROP TRIGGER IF EXISTS enterprise_subscriptions_updated_at ON public.enterprise_subscriptions;
CREATE TRIGGER enterprise_subscriptions_updated_at
  BEFORE UPDATE ON public.enterprise_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Part 3: Enterprise Adoption Requests Table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.enterprise_adoption_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES public.enterprises(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  responded_by uuid REFERENCES auth.users(id),
  responded_at timestamptz,
  expires_at timestamptz
);

-- Index for finding requests by enterprise or org
CREATE INDEX IF NOT EXISTS enterprise_adoption_requests_enterprise_idx
  ON public.enterprise_adoption_requests(enterprise_id);
CREATE INDEX IF NOT EXISTS enterprise_adoption_requests_org_idx
  ON public.enterprise_adoption_requests(organization_id);
CREATE INDEX IF NOT EXISTS enterprise_adoption_requests_status_idx
  ON public.enterprise_adoption_requests(status) WHERE status = 'pending';

-- =====================================================
-- Part 4: User Enterprise Roles Table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.user_enterprise_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enterprise_id uuid NOT NULL REFERENCES public.enterprises(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'billing_admin', 'org_admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One role per user per enterprise
CREATE UNIQUE INDEX IF NOT EXISTS user_enterprise_roles_user_enterprise_idx
  ON public.user_enterprise_roles(user_id, enterprise_id);

-- Indexes for lookups
CREATE INDEX IF NOT EXISTS user_enterprise_roles_user_idx
  ON public.user_enterprise_roles(user_id);
CREATE INDEX IF NOT EXISTS user_enterprise_roles_enterprise_idx
  ON public.user_enterprise_roles(enterprise_id);

-- =====================================================
-- Part 5: Modify Organizations Table
-- =====================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS enterprise_id uuid REFERENCES public.enterprises(id) ON DELETE SET NULL;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS enterprise_relationship_type text
  CHECK (enterprise_relationship_type IN ('created', 'adopted'));

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS enterprise_adopted_at timestamptz;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS original_subscription_id uuid;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS original_subscription_status text;

-- Index for finding orgs by enterprise
CREATE INDEX IF NOT EXISTS organizations_enterprise_idx
  ON public.organizations(enterprise_id)
  WHERE enterprise_id IS NOT NULL;

-- =====================================================
-- Part 6: Update organization_subscriptions status
-- =====================================================

-- Drop and recreate the status check constraint to allow 'enterprise_managed'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'organization_subscriptions_status_check'
    AND table_name = 'organization_subscriptions'
  ) THEN
    ALTER TABLE public.organization_subscriptions
      DROP CONSTRAINT organization_subscriptions_status_check;
  END IF;
END
$$;

-- Add new constraint allowing enterprise_managed status
ALTER TABLE public.organization_subscriptions
  ADD CONSTRAINT organization_subscriptions_status_check
  CHECK (status IN ('pending', 'active', 'past_due', 'canceled', 'trialing', 'enterprise_managed'));

-- =====================================================
-- Part 7: Enterprise Alumni Counts View
-- =====================================================

CREATE OR REPLACE VIEW public.enterprise_alumni_counts AS
SELECT
  e.id AS enterprise_id,
  COUNT(DISTINCT a.id) AS total_alumni_count,
  COUNT(DISTINCT o.id) AS sub_org_count
FROM public.enterprises e
LEFT JOIN public.organizations o ON o.enterprise_id = e.id
LEFT JOIN public.alumni a ON a.organization_id = o.id AND a.deleted_at IS NULL
GROUP BY e.id;

-- =====================================================
-- Part 8: Helper Functions
-- =====================================================

-- Check if current user has any role in the enterprise
CREATE OR REPLACE FUNCTION public.is_enterprise_member(ent_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_enterprise_roles
    WHERE enterprise_id = ent_id
      AND user_id = auth.uid()
  );
$$;

-- Check if current user is an owner or has admin role in the enterprise
CREATE OR REPLACE FUNCTION public.is_enterprise_admin(ent_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_enterprise_roles
    WHERE enterprise_id = ent_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'billing_admin', 'org_admin')
  );
$$;

-- Check if enterprise can add more alumni based on tier
CREATE OR REPLACE FUNCTION public.can_enterprise_add_alumni(p_enterprise_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_tier text;
  v_limit integer;
  v_count integer;
  v_status text;
BEGIN
  -- Get enterprise subscription details
  SELECT alumni_tier, pooled_alumni_limit, status
  INTO v_tier, v_limit, v_status
  FROM public.enterprise_subscriptions
  WHERE enterprise_id = p_enterprise_id
  LIMIT 1;

  -- If no subscription or not active, deny
  IF v_tier IS NULL OR v_status NOT IN ('active', 'trialing') THEN
    RETURN false;
  END IF;

  -- Custom tier uses explicit limit, null means unlimited
  IF v_tier = 'custom' THEN
    IF v_limit IS NULL THEN
      RETURN true;
    END IF;
  ELSE
    -- Standard tier limits (tier_3 is unlimited in app pricing)
    v_limit := CASE v_tier
      WHEN 'tier_1' THEN 5000
      WHEN 'tier_2' THEN 10000
      WHEN 'tier_3' THEN NULL
      ELSE 0
    END;
  END IF;

  -- Unlimited tiers
  IF v_limit IS NULL THEN
    RETURN true;
  END IF;

  -- Get current alumni count across all sub-orgs
  SELECT COALESCE(total_alumni_count, 0)
  INTO v_count
  FROM public.enterprise_alumni_counts
  WHERE enterprise_id = p_enterprise_id;

  RETURN v_count < v_limit;
END;
$$;

-- =====================================================
-- Part 9: Enable RLS
-- =====================================================

ALTER TABLE public.enterprises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_adoption_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_enterprise_roles ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- Part 10: RLS Policies - Enterprises
-- =====================================================

-- Enterprise members can view their enterprise
DROP POLICY IF EXISTS enterprises_select ON public.enterprises;
CREATE POLICY enterprises_select ON public.enterprises
  FOR SELECT USING (public.is_enterprise_member(id));

-- Only service role can insert/update/delete enterprises
DROP POLICY IF EXISTS enterprises_service_insert ON public.enterprises;
CREATE POLICY enterprises_service_insert ON public.enterprises
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS enterprises_service_update ON public.enterprises;
CREATE POLICY enterprises_service_update ON public.enterprises
  FOR UPDATE USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS enterprises_service_delete ON public.enterprises;
CREATE POLICY enterprises_service_delete ON public.enterprises
  FOR DELETE USING (auth.role() = 'service_role');

-- =====================================================
-- Part 11: RLS Policies - Enterprise Subscriptions
-- =====================================================

-- Service role only for sensitive billing data
DROP POLICY IF EXISTS enterprise_subscriptions_service_only ON public.enterprise_subscriptions;
CREATE POLICY enterprise_subscriptions_service_only ON public.enterprise_subscriptions
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- =====================================================
-- Part 12: RLS Policies - User Enterprise Roles
-- =====================================================

-- Users can see their own roles
DROP POLICY IF EXISTS user_enterprise_roles_select_own ON public.user_enterprise_roles;
CREATE POLICY user_enterprise_roles_select_own ON public.user_enterprise_roles
  FOR SELECT USING (user_id = auth.uid());

-- Owners can see all roles in their enterprise
DROP POLICY IF EXISTS user_enterprise_roles_select_owner ON public.user_enterprise_roles;
CREATE POLICY user_enterprise_roles_select_owner ON public.user_enterprise_roles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_enterprise_roles uer
      WHERE uer.enterprise_id = user_enterprise_roles.enterprise_id
        AND uer.user_id = auth.uid()
        AND uer.role = 'owner'
    )
  );

-- Service role can manage all roles
DROP POLICY IF EXISTS user_enterprise_roles_service_all ON public.user_enterprise_roles;
CREATE POLICY user_enterprise_roles_service_all ON public.user_enterprise_roles
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- =====================================================
-- Part 13: RLS Policies - Enterprise Adoption Requests
-- =====================================================

-- Org admins can see requests for their org
DROP POLICY IF EXISTS enterprise_adoption_requests_select_org_admin ON public.enterprise_adoption_requests;
CREATE POLICY enterprise_adoption_requests_select_org_admin ON public.enterprise_adoption_requests
  FOR SELECT USING (public.is_org_admin(organization_id));

-- Enterprise members can see their enterprise's requests
DROP POLICY IF EXISTS enterprise_adoption_requests_select_enterprise ON public.enterprise_adoption_requests;
CREATE POLICY enterprise_adoption_requests_select_enterprise ON public.enterprise_adoption_requests
  FOR SELECT USING (public.is_enterprise_member(enterprise_id));

-- Service role can manage all requests
DROP POLICY IF EXISTS enterprise_adoption_requests_service_all ON public.enterprise_adoption_requests;
CREATE POLICY enterprise_adoption_requests_service_all ON public.enterprise_adoption_requests
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- =====================================================
-- Part 14: Grant Execute on Helper Functions
-- =====================================================

GRANT EXECUTE ON FUNCTION public.is_enterprise_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_enterprise_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_enterprise_add_alumni(uuid) TO authenticated;

-- Grant select on the view
GRANT SELECT ON public.enterprise_alumni_counts TO authenticated;

-- =====================================================
-- Part 15: Comments for Documentation
-- =====================================================

COMMENT ON TABLE public.enterprises IS 'Enterprise accounts for managing multiple organizations under a single billing entity';
COMMENT ON TABLE public.enterprise_subscriptions IS 'Billing subscriptions for enterprise accounts with pooled alumni limits';
COMMENT ON TABLE public.enterprise_adoption_requests IS 'Pending requests for enterprises to adopt existing organizations';
COMMENT ON TABLE public.user_enterprise_roles IS 'User roles within enterprise accounts (owner, billing_admin, org_admin)';

COMMENT ON COLUMN public.organizations.enterprise_id IS 'Reference to parent enterprise if org is enterprise-managed';
COMMENT ON COLUMN public.organizations.enterprise_relationship_type IS 'How org joined enterprise: created (new) or adopted (existing)';
COMMENT ON COLUMN public.organizations.enterprise_adopted_at IS 'When an existing org was adopted by an enterprise';
COMMENT ON COLUMN public.organizations.original_subscription_id IS 'Reference to original subscription before enterprise adoption (for restoration)';
COMMENT ON COLUMN public.organizations.original_subscription_status IS 'Original subscription status before enterprise adoption';

COMMENT ON COLUMN public.enterprise_subscriptions.alumni_tier IS 'Pricing tier: tier_1 (5000), tier_2 (10000), tier_3 (unlimited), or custom';
COMMENT ON COLUMN public.enterprise_subscriptions.pooled_alumni_limit IS 'Custom alumni limit for custom tier (null = unlimited)';

COMMENT ON VIEW public.enterprise_alumni_counts IS 'Aggregated alumni counts across all organizations in each enterprise';
