-- =====================================================
-- Migration: Embeds Fix & Pending Approvals
-- =====================================================

-- Part A: Philanthropy Embeds Fix
-- =====================================================

-- Add composite index for sorting embeds by org and display order
CREATE INDEX IF NOT EXISTS org_philanthropy_embeds_org_order_idx 
  ON public.org_philanthropy_embeds(organization_id, display_order);

-- Create or replace updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at trigger to org_philanthropy_embeds
DROP TRIGGER IF EXISTS org_philanthropy_embeds_updated_at ON public.org_philanthropy_embeds;
CREATE TRIGGER org_philanthropy_embeds_updated_at
  BEFORE UPDATE ON public.org_philanthropy_embeds
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Part B: Pending Membership Approval System
-- =====================================================

-- Add 'pending' to membership_status enum
DO $$
BEGIN
  -- Check if 'pending' already exists in the enum
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'pending' 
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'membership_status')
  ) THEN
    ALTER TYPE public.membership_status ADD VALUE 'pending';
  END IF;
END
$$;

-- Update RLS policies for user_organization_roles
-- Admins see all org memberships; non-admins see only their own
DROP POLICY IF EXISTS user_org_roles_select ON public.user_organization_roles;
CREATE POLICY user_org_roles_select ON public.user_organization_roles
  FOR SELECT USING (
    user_id = auth.uid() OR 
    has_active_role(organization_id, array['admin'])
  );

-- Only admins can update membership status
DROP POLICY IF EXISTS user_org_roles_update ON public.user_organization_roles;
CREATE POLICY user_org_roles_update ON public.user_organization_roles
  FOR UPDATE USING (has_active_role(organization_id, array['admin']));

-- Allow users to insert their own membership (for join flow)
DROP POLICY IF EXISTS user_org_roles_insert ON public.user_organization_roles;
CREATE POLICY user_org_roles_insert ON public.user_organization_roles
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Only admins can delete memberships
DROP POLICY IF EXISTS user_org_roles_delete ON public.user_organization_roles;
CREATE POLICY user_org_roles_delete ON public.user_organization_roles
  FOR DELETE USING (has_active_role(organization_id, array['admin']));

