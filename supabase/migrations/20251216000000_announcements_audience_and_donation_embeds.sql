-- =====================================================
-- Migration: Announcements Audience Fix & Donation Embeds
-- =====================================================

-- Part 1: Fix Announcements Audience Column
-- =====================================================

-- Drop existing constraint if it exists and recreate with new values
DO $$
BEGIN
  -- Check if audience column exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'announcements' 
    AND column_name = 'audience'
  ) THEN
    -- Drop existing check constraint
    ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_audience_check;
  ELSE
    -- Add column if it doesn't exist
    ALTER TABLE public.announcements ADD COLUMN audience text DEFAULT 'all';
  END IF;
END
$$;

-- Add new check constraint with extended values
ALTER TABLE public.announcements 
  ADD CONSTRAINT announcements_audience_check 
  CHECK (audience IN ('all', 'members', 'active_members', 'alumni', 'individuals'));

-- Update default value
ALTER TABLE public.announcements ALTER COLUMN audience SET DEFAULT 'all';

-- Rename target_user_ids to audience_user_ids if needed (for clarity)
-- First check if target_user_ids exists and audience_user_ids doesn't
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'announcements' 
    AND column_name = 'target_user_ids'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'announcements' 
    AND column_name = 'audience_user_ids'
  ) THEN
    ALTER TABLE public.announcements RENAME COLUMN target_user_ids TO audience_user_ids;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'announcements' 
    AND column_name = 'audience_user_ids'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'announcements' 
    AND column_name = 'target_user_ids'
  ) THEN
    ALTER TABLE public.announcements ADD COLUMN audience_user_ids uuid[];
  END IF;
END
$$;

-- Update existing 'both' values to 'all' for consistency
UPDATE public.announcements SET audience = 'all' WHERE audience = 'both';

-- Part 2: RLS Policies for Announcements (audience-based visibility)
-- =====================================================

-- Drop existing policies to recreate
DROP POLICY IF EXISTS announcements_select ON public.announcements;
DROP POLICY IF EXISTS announcements_insert ON public.announcements;
DROP POLICY IF EXISTS announcements_update ON public.announcements;
DROP POLICY IF EXISTS announcements_delete ON public.announcements;

-- Create helper function to check if user should see announcement
CREATE OR REPLACE FUNCTION can_view_announcement(announcement_row public.announcements)
RETURNS boolean AS $$
DECLARE
  user_role text;
  user_id uuid;
BEGIN
  user_id := auth.uid();
  
  -- Get user's role in the org
  SELECT role INTO user_role
  FROM public.user_organization_roles
  WHERE user_organization_roles.user_id = user_id
    AND organization_id = announcement_row.organization_id
    AND status = 'active'
  LIMIT 1;
  
  -- Admins see everything
  IF user_role = 'admin' THEN
    RETURN true;
  END IF;
  
  -- Check audience type
  CASE announcement_row.audience
    WHEN 'all' THEN
      RETURN user_role IS NOT NULL;
    WHEN 'members' THEN
      RETURN user_role IN ('admin', 'active_member', 'member');
    WHEN 'active_members' THEN
      RETURN user_role IN ('admin', 'active_member');
    WHEN 'alumni' THEN
      RETURN user_role IN ('admin', 'alumni');
    WHEN 'individuals' THEN
      RETURN user_id = ANY(announcement_row.audience_user_ids);
    ELSE
      RETURN user_role IS NOT NULL;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- SELECT: Users can see announcements based on audience
CREATE POLICY announcements_select ON public.announcements
  FOR SELECT USING (can_view_announcement(announcements));

-- INSERT: Admins only
CREATE POLICY announcements_insert ON public.announcements
  FOR INSERT WITH CHECK (has_active_role(organization_id, array['admin']));

-- UPDATE: Admins only
CREATE POLICY announcements_update ON public.announcements
  FOR UPDATE USING (has_active_role(organization_id, array['admin']))
  WITH CHECK (has_active_role(organization_id, array['admin']));

-- DELETE: Admins only
CREATE POLICY announcements_delete ON public.announcements
  FOR DELETE USING (has_active_role(organization_id, array['admin']));


-- Part 3: Donation Embeds Table (matching philanthropy embeds)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.org_donation_embeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL CHECK (url ~ '^https://'),
  embed_type text NOT NULL CHECK (embed_type IN ('link', 'iframe')),
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for donation embeds
CREATE INDEX IF NOT EXISTS org_donation_embeds_org_idx ON public.org_donation_embeds(organization_id);
CREATE INDEX IF NOT EXISTS org_donation_embeds_org_order_idx ON public.org_donation_embeds(organization_id, display_order);

-- Enable RLS
ALTER TABLE public.org_donation_embeds ENABLE ROW LEVEL SECURITY;

-- RLS Policies for donation embeds
DROP POLICY IF EXISTS org_donation_embeds_select ON public.org_donation_embeds;
CREATE POLICY org_donation_embeds_select ON public.org_donation_embeds
  FOR SELECT USING (has_active_role(organization_id, array['admin', 'active_member', 'alumni']));

DROP POLICY IF EXISTS org_donation_embeds_insert ON public.org_donation_embeds;
CREATE POLICY org_donation_embeds_insert ON public.org_donation_embeds
  FOR INSERT WITH CHECK (has_active_role(organization_id, array['admin']));

DROP POLICY IF EXISTS org_donation_embeds_update ON public.org_donation_embeds;
CREATE POLICY org_donation_embeds_update ON public.org_donation_embeds
  FOR UPDATE USING (has_active_role(organization_id, array['admin']))
  WITH CHECK (has_active_role(organization_id, array['admin']));

DROP POLICY IF EXISTS org_donation_embeds_delete ON public.org_donation_embeds;
CREATE POLICY org_donation_embeds_delete ON public.org_donation_embeds
  FOR DELETE USING (has_active_role(organization_id, array['admin']));

-- Add updated_at trigger for donation embeds
DROP TRIGGER IF EXISTS org_donation_embeds_updated_at ON public.org_donation_embeds;
CREATE TRIGGER org_donation_embeds_updated_at
  BEFORE UPDATE ON public.org_donation_embeds
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Migrate existing donation_embed_url to new table
INSERT INTO public.org_donation_embeds (organization_id, title, url, embed_type, display_order)
SELECT 
  id,
  'Donation Page',
  donation_embed_url,
  'iframe',
  0
FROM public.organizations
WHERE donation_embed_url IS NOT NULL 
  AND donation_embed_url != ''
  AND donation_embed_url ~ '^https://'
ON CONFLICT DO NOTHING;




