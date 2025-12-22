-- =====================================================
-- Migration: Schema Fixes for Multi-Tenant App
-- Date: 2025-12-17
-- Purpose: Fix invite system, add RPCs, ensure triggers
-- =====================================================

-- =====================================================
-- Part 1: User Sync Trigger (auth.users -> public.users)
-- =====================================================

-- Ensure public.users table exists with correct structure
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create index on email for lookups
CREATE INDEX IF NOT EXISTS users_email_idx ON public.users(email);

-- Enable RLS on users table
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Users can read any user (for displaying names in UI)
DROP POLICY IF EXISTS users_select ON public.users;
CREATE POLICY users_select ON public.users
  FOR SELECT USING (true);

-- Users can only update their own row
DROP POLICY IF EXISTS users_update ON public.users;
CREATE POLICY users_update ON public.users
  FOR UPDATE USING (id = auth.uid());

-- Grant permissions
GRANT SELECT ON public.users TO authenticated;
GRANT UPDATE ON public.users TO authenticated;

-- Function to handle new user creation (sync from auth.users)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on auth.users (only if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
  ) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_new_user();
  END IF;
END
$$;

-- Also trigger on update (for email/name changes)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_updated'
  ) THEN
    CREATE TRIGGER on_auth_user_updated
      AFTER UPDATE ON auth.users
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_new_user();
  END IF;
END
$$;

-- Backfill existing auth users into public.users
INSERT INTO public.users (id, email, name, avatar_url)
SELECT 
  id, 
  email, 
  COALESCE(raw_user_meta_data->>'name', raw_user_meta_data->>'full_name'),
  raw_user_meta_data->>'avatar_url'
FROM auth.users
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  name = COALESCE(EXCLUDED.name, public.users.name),
  avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url);

-- =====================================================
-- Part 2: Helper Functions for RLS
-- =====================================================

-- Check if current user is a member of the organization (any active role)
CREATE OR REPLACE FUNCTION public.is_org_member(org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_organization_roles
    WHERE organization_id = org_id 
      AND user_id = auth.uid() 
      AND status = 'active'
  );
$$;

-- Check if current user is an admin of the organization
CREATE OR REPLACE FUNCTION public.is_org_admin(org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_organization_roles
    WHERE organization_id = org_id 
      AND user_id = auth.uid() 
      AND status = 'active'
      AND role = 'admin'
  );
$$;

-- =====================================================
-- Part 3: Invite System RPCs
-- =====================================================

-- RPC: Create organization invite (admin only, server-side code generation)
CREATE OR REPLACE FUNCTION public.create_org_invite(
  p_organization_id uuid,
  p_role text DEFAULT 'active_member',
  p_uses int DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS public.organization_invites
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_code text;
  v_token text;
  v_result public.organization_invites;
BEGIN
  -- Verify caller is admin of the organization
  IF NOT public.is_org_admin(p_organization_id) THEN
    RAISE EXCEPTION 'Only organization admins can create invites';
  END IF;
  
  -- Validate role
  IF p_role NOT IN ('admin', 'active_member', 'alumni') THEN
    RAISE EXCEPTION 'Invalid role. Must be admin, active_member, or alumni';
  END IF;
  
  -- Generate secure random code (8 chars, alphanumeric, no confusing chars)
  v_code := upper(substr(
    replace(replace(replace(
      encode(gen_random_bytes(6), 'base64'),
      '/', ''), '+', ''), '=', ''),
    1, 8
  ));
  
  -- Generate secure token (32 chars for URL-based invites)
  v_token := replace(replace(replace(
    encode(gen_random_bytes(24), 'base64'),
    '/', '_'), '+', '-'), '=', '');
  
  -- Insert the invite
  INSERT INTO public.organization_invites (
    organization_id, 
    code, 
    token, 
    role, 
    uses_remaining, 
    expires_at, 
    created_by_user_id
  )
  VALUES (
    p_organization_id, 
    v_code, 
    v_token, 
    p_role, 
    p_uses, 
    p_expires_at, 
    auth.uid()
  )
  RETURNING * INTO v_result;
  
  RETURN v_result;
END;
$$;

-- RPC: Redeem organization invite (any authenticated user)
CREATE OR REPLACE FUNCTION public.redeem_org_invite(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
  
  -- Find invite by code (case-insensitive) or token
  SELECT * INTO v_invite 
  FROM public.organization_invites
  WHERE (upper(code) = upper(trim(p_code)) OR token = trim(p_code))
    AND revoked_at IS NULL;
  
  IF v_invite IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid invite code');
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
    -- Get org for slug
    SELECT * INTO v_org FROM public.organizations WHERE id = v_invite.organization_id;
    
    IF v_existing.status = 'revoked' THEN
      RETURN jsonb_build_object(
        'success', false, 
        'error', 'Your access to this organization has been revoked. Contact an admin.'
      );
    END IF;
    
    -- Already an active or pending member
    RETURN jsonb_build_object(
      'success', true, 
      'organization_id', v_invite.organization_id,
      'slug', v_org.slug,
      'name', v_org.name,
      'already_member', true,
      'status', v_existing.status
    );
  END IF;
  
  -- Insert new membership with pending status (requires admin approval)
  INSERT INTO public.user_organization_roles (user_id, organization_id, role, status)
  VALUES (v_user_id, v_invite.organization_id, v_invite.role, 'pending');
  
  -- Decrement uses_remaining if it's set
  IF v_invite.uses_remaining IS NOT NULL THEN
    UPDATE public.organization_invites 
    SET uses_remaining = uses_remaining - 1 
    WHERE id = v_invite.id;
  END IF;
  
  -- Get organization details for response
  SELECT * INTO v_org FROM public.organizations WHERE id = v_invite.organization_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'organization_id', v_invite.organization_id,
    'slug', v_org.slug,
    'name', v_org.name,
    'role', v_invite.role,
    'pending_approval', true
  );
END;
$$;

-- RPC: Redeem by token (convenience wrapper)
CREATE OR REPLACE FUNCTION public.redeem_org_invite_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.redeem_org_invite(p_token);
END;
$$;

-- =====================================================
-- Part 4: Dropdown Options RPC
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_dropdown_options(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
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
-- Part 5: Missing Indexes for Performance
-- =====================================================

-- Organization-scoped table indexes
CREATE INDEX IF NOT EXISTS members_org_id_idx ON public.members(organization_id);
CREATE INDEX IF NOT EXISTS members_org_deleted_idx ON public.members(organization_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS events_org_id_idx ON public.events(organization_id);
CREATE INDEX IF NOT EXISTS events_org_deleted_idx ON public.events(organization_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS announcements_org_id_idx ON public.announcements(organization_id);
CREATE INDEX IF NOT EXISTS announcements_org_deleted_idx ON public.announcements(organization_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS donations_org_id_idx ON public.donations(organization_id);
CREATE INDEX IF NOT EXISTS donations_org_deleted_idx ON public.donations(organization_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_org_id_idx ON public.notifications(organization_id);
CREATE INDEX IF NOT EXISTS notifications_org_deleted_idx ON public.notifications(organization_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS philanthropy_events_org_id_idx ON public.philanthropy_events(organization_id);
CREATE INDEX IF NOT EXISTS philanthropy_events_org_deleted_idx ON public.philanthropy_events(organization_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS records_org_id_idx ON public.records(organization_id);
CREATE INDEX IF NOT EXISTS competitions_org_id_idx ON public.competitions(organization_id);

-- User organization roles indexes
CREATE INDEX IF NOT EXISTS user_org_roles_org_idx ON public.user_organization_roles(organization_id);
CREATE INDEX IF NOT EXISTS user_org_roles_user_idx ON public.user_organization_roles(user_id);
CREATE INDEX IF NOT EXISTS user_org_roles_active_idx ON public.user_organization_roles(organization_id, user_id) WHERE status = 'active';

-- =====================================================
-- Part 6: Ensure updated_at Triggers Exist
-- =====================================================

-- Generic updated_at function (already exists from previous migration, but ensure it's there)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for tables that need them
DO $$
DECLARE
  tables_to_update text[] := ARRAY['members', 'alumni', 'events', 'announcements', 'mentorship_pairs', 'mentorship_logs', 'workouts', 'workout_logs', 'notification_preferences'];
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY tables_to_update
  LOOP
    -- Check if table exists and has updated_at column
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'updated_at'
    ) THEN
      -- Drop existing trigger if exists and recreate
      EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at ON public.%I', tbl, tbl);
      EXECUTE format('CREATE TRIGGER %I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', tbl, tbl);
    END IF;
  END LOOP;
END
$$;

-- =====================================================
-- Part 7: RLS Policy Fixes
-- =====================================================

-- Ensure RLS is enabled on core tables
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alumni ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.philanthropy_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- Members policies
DROP POLICY IF EXISTS members_select ON public.members;
CREATE POLICY members_select ON public.members
  FOR SELECT USING (public.has_active_role(organization_id, ARRAY['admin', 'active_member', 'alumni']));

DROP POLICY IF EXISTS members_insert ON public.members;
CREATE POLICY members_insert ON public.members
  FOR INSERT WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS members_update ON public.members;
CREATE POLICY members_update ON public.members
  FOR UPDATE USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS members_delete ON public.members;
CREATE POLICY members_delete ON public.members
  FOR DELETE USING (public.is_org_admin(organization_id));

-- Alumni policies
DROP POLICY IF EXISTS alumni_select ON public.alumni;
CREATE POLICY alumni_select ON public.alumni
  FOR SELECT USING (public.has_active_role(organization_id, ARRAY['admin', 'active_member', 'alumni']));

DROP POLICY IF EXISTS alumni_insert ON public.alumni;
CREATE POLICY alumni_insert ON public.alumni
  FOR INSERT WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS alumni_update ON public.alumni;
CREATE POLICY alumni_update ON public.alumni
  FOR UPDATE USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS alumni_delete ON public.alumni;
CREATE POLICY alumni_delete ON public.alumni
  FOR DELETE USING (public.is_org_admin(organization_id));

-- Donations policies
DROP POLICY IF EXISTS donations_select ON public.donations;
CREATE POLICY donations_select ON public.donations
  FOR SELECT USING (public.has_active_role(organization_id, ARRAY['admin', 'active_member', 'alumni']));

DROP POLICY IF EXISTS donations_insert ON public.donations;
CREATE POLICY donations_insert ON public.donations
  FOR INSERT WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS donations_update ON public.donations;
CREATE POLICY donations_update ON public.donations
  FOR UPDATE USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS donations_delete ON public.donations;
CREATE POLICY donations_delete ON public.donations
  FOR DELETE USING (public.is_org_admin(organization_id));

-- Records policies
DROP POLICY IF EXISTS records_select ON public.records;
CREATE POLICY records_select ON public.records
  FOR SELECT USING (public.has_active_role(organization_id, ARRAY['admin', 'active_member', 'alumni']));

DROP POLICY IF EXISTS records_insert ON public.records;
CREATE POLICY records_insert ON public.records
  FOR INSERT WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS records_update ON public.records;
CREATE POLICY records_update ON public.records
  FOR UPDATE USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS records_delete ON public.records;
CREATE POLICY records_delete ON public.records
  FOR DELETE USING (public.is_org_admin(organization_id));

-- Competitions policies
DROP POLICY IF EXISTS competitions_select ON public.competitions;
CREATE POLICY competitions_select ON public.competitions
  FOR SELECT USING (public.has_active_role(organization_id, ARRAY['admin', 'active_member', 'alumni']));

DROP POLICY IF EXISTS competitions_insert ON public.competitions;
CREATE POLICY competitions_insert ON public.competitions
  FOR INSERT WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS competitions_update ON public.competitions;
CREATE POLICY competitions_update ON public.competitions
  FOR UPDATE USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS competitions_delete ON public.competitions;
CREATE POLICY competitions_delete ON public.competitions
  FOR DELETE USING (public.is_org_admin(organization_id));

-- Philanthropy events policies
DROP POLICY IF EXISTS philanthropy_events_select ON public.philanthropy_events;
CREATE POLICY philanthropy_events_select ON public.philanthropy_events
  FOR SELECT USING (public.has_active_role(organization_id, ARRAY['admin', 'active_member', 'alumni']));

DROP POLICY IF EXISTS philanthropy_events_insert ON public.philanthropy_events;
CREATE POLICY philanthropy_events_insert ON public.philanthropy_events
  FOR INSERT WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS philanthropy_events_update ON public.philanthropy_events;
CREATE POLICY philanthropy_events_update ON public.philanthropy_events
  FOR UPDATE USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS philanthropy_events_delete ON public.philanthropy_events;
CREATE POLICY philanthropy_events_delete ON public.philanthropy_events
  FOR DELETE USING (public.is_org_admin(organization_id));

-- Notification preferences policies (users can only manage their own)
DROP POLICY IF EXISTS notification_preferences_select ON public.notification_preferences;
CREATE POLICY notification_preferences_select ON public.notification_preferences
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS notification_preferences_insert ON public.notification_preferences;
CREATE POLICY notification_preferences_insert ON public.notification_preferences
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS notification_preferences_update ON public.notification_preferences;
CREATE POLICY notification_preferences_update ON public.notification_preferences
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS notification_preferences_delete ON public.notification_preferences;
CREATE POLICY notification_preferences_delete ON public.notification_preferences
  FOR DELETE USING (user_id = auth.uid());

-- Notifications policies (org members can view, admins can manage)
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT USING (public.has_active_role(organization_id, ARRAY['admin', 'active_member', 'alumni']));

DROP POLICY IF EXISTS notifications_insert ON public.notifications;
CREATE POLICY notifications_insert ON public.notifications
  FOR INSERT WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS notifications_delete ON public.notifications;
CREATE POLICY notifications_delete ON public.notifications
  FOR DELETE USING (public.is_org_admin(organization_id));

-- =====================================================
-- Part 8: Grant Execute on RPCs
-- =====================================================

GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_org_invite(uuid, text, int, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_org_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_org_invite_by_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dropdown_options(uuid) TO authenticated;




