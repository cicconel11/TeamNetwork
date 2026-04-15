-- Tighten donation RLS to enforce visibility column
-- P1: Non-admins can only SELECT rows where visibility = 'public'

DROP POLICY IF EXISTS organization_donations_select ON organization_donations;
CREATE POLICY organization_donations_select ON organization_donations
  FOR SELECT TO public
  USING (
    is_org_admin(organization_id)
    OR (
      has_active_role(organization_id, ARRAY['active_member','alumni','parent'])
      AND visibility = 'public'
    )
  );

-- Stats table: restrict to admins / page editors only
-- Non-admins compute their own totals from filtered donation rows
DROP POLICY IF EXISTS organization_donation_stats_select ON organization_donation_stats;
CREATE POLICY organization_donation_stats_select ON organization_donation_stats
  FOR SELECT TO public
  USING (
    is_org_admin(organization_id)
    OR can_edit_page(organization_id, '/donations')
  );
