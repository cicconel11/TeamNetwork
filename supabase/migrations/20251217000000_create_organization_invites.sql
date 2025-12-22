-- Migration: Create organization_invites table
-- This table was missing - the previous migration only had ALTER TABLE statements
-- without a corresponding CREATE TABLE

-- Create the organization_invites table
CREATE TABLE IF NOT EXISTS public.organization_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  token text UNIQUE,
  role text NOT NULL DEFAULT 'active_member',
  uses_remaining int,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create unique index on code per organization
CREATE UNIQUE INDEX IF NOT EXISTS organization_invites_org_code_idx 
  ON public.organization_invites(organization_id, code);

-- Create index for lookups by token
CREATE INDEX IF NOT EXISTS organization_invites_token_idx 
  ON public.organization_invites(token) WHERE token IS NOT NULL;

-- Create index for organization lookups
CREATE INDEX IF NOT EXISTS organization_invites_org_id_idx 
  ON public.organization_invites(organization_id);

-- Enable RLS
ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;

-- RLS Policies (recreate to ensure they exist)
DROP POLICY IF EXISTS organization_invites_select ON public.organization_invites;
CREATE POLICY organization_invites_select
  ON public.organization_invites
  FOR SELECT USING (
    -- Admins can see all invites for their org
    has_active_role(organization_id, array['admin'])
    -- Or anyone can look up a valid token for joining
    OR (token IS NOT NULL AND revoked_at IS NULL)
  );

DROP POLICY IF EXISTS organization_invites_insert ON public.organization_invites;
CREATE POLICY organization_invites_insert
  ON public.organization_invites
  FOR INSERT WITH CHECK (has_active_role(organization_id, array['admin']));

DROP POLICY IF EXISTS organization_invites_update ON public.organization_invites;
CREATE POLICY organization_invites_update
  ON public.organization_invites
  FOR UPDATE USING (has_active_role(organization_id, array['admin']))
  WITH CHECK (has_active_role(organization_id, array['admin']));

DROP POLICY IF EXISTS organization_invites_delete ON public.organization_invites;
CREATE POLICY organization_invites_delete
  ON public.organization_invites
  FOR DELETE USING (has_active_role(organization_id, array['admin']));

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_invites TO authenticated;




