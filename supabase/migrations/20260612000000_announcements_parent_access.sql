-- Migration: 20260612000000_announcements_parent_access.sql
-- Add 'parent' to can_view_announcement() so parents can read alumni-targeted announcements.
-- The existing announcements_select RLS policy already delegates to this function,
-- so replacing the function body is sufficient — no policy changes needed.

CREATE OR REPLACE FUNCTION can_view_announcement(announcement_row public.announcements)
RETURNS boolean AS $$
DECLARE
  user_role text;
  user_id uuid;
BEGIN
  user_id := auth.uid();

  SELECT role INTO user_role
  FROM public.user_organization_roles
  WHERE user_organization_roles.user_id = user_id
    AND organization_id = announcement_row.organization_id
    AND status = 'active'
  LIMIT 1;

  IF user_role = 'admin' THEN
    RETURN true;
  END IF;

  CASE announcement_row.audience
    WHEN 'all' THEN
      RETURN user_role IS NOT NULL;
    WHEN 'members' THEN
      RETURN user_role IN ('admin', 'active_member', 'member');
    WHEN 'active_members' THEN
      RETURN user_role IN ('admin', 'active_member');
    WHEN 'alumni' THEN
      RETURN user_role IN ('admin', 'alumni', 'parent');
    WHEN 'individuals' THEN
      RETURN user_id = ANY(announcement_row.audience_user_ids);
    ELSE
      RETURN user_role IS NOT NULL;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
