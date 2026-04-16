-- Add organization-level toggle to hide donor names from non-admin members
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS hide_donor_names boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.hide_donor_names
  IS 'When true, donor names and emails are hidden from alumni, active members, and parents on donation pages.';

-- Recreate donation policies to enforce the new flag and restrict stats to admins/editors

DROP POLICY IF EXISTS organization_donation_stats_select ON organization_donation_stats;
CREATE POLICY organization_donation_stats_select ON organization_donation_stats
  FOR SELECT TO public
  USING (
    is_org_admin(organization_id)
    OR can_edit_page(organization_id, '/donations')
  );

DROP POLICY IF EXISTS organization_donations_select ON organization_donations;
CREATE POLICY organization_donations_select ON organization_donations
  FOR SELECT TO public
  USING (
    is_org_admin(organization_id)
    OR can_edit_page(organization_id, '/donations')
    OR (
      has_active_role(organization_id, ARRAY['active_member','alumni','parent'])
      AND visibility = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.id = organization_id AND o.hide_donor_names = true
      )
    )
  );
