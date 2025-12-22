-- Alumni Data Expansion: Add new columns for enhanced filtering and profiles
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS phone_number text;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS industry text;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS current_company text;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS current_city text;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS position_title text;

-- Indexes for efficient alumni filtering
CREATE INDEX IF NOT EXISTS alumni_graduation_year_idx ON public.alumni(graduation_year);
CREATE INDEX IF NOT EXISTS alumni_industry_idx ON public.alumni(industry);
CREATE INDEX IF NOT EXISTS alumni_current_company_idx ON public.alumni(current_company);
CREATE INDEX IF NOT EXISTS alumni_current_city_idx ON public.alumni(current_city);
CREATE INDEX IF NOT EXISTS alumni_position_title_idx ON public.alumni(position_title);
CREATE INDEX IF NOT EXISTS alumni_org_deleted_idx ON public.alumni(organization_id) WHERE deleted_at IS NULL;

-- Philanthropy Embeds Table
CREATE TABLE IF NOT EXISTS public.org_philanthropy_embeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL CHECK (url ~ '^https://'),
  embed_type text NOT NULL CHECK (embed_type IN ('link', 'iframe')),
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_philanthropy_embeds_org_idx ON public.org_philanthropy_embeds(organization_id);

-- Invite System Enhancement
ALTER TABLE public.organization_invites ADD COLUMN IF NOT EXISTS token text UNIQUE;
ALTER TABLE public.organization_invites ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

-- Announcements Audience Field for targeted notifications
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS audience text DEFAULT 'both' CHECK (audience IN ('members', 'alumni', 'both'));
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS target_user_ids uuid[];

-- Events Audience Field for targeted notifications
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS audience text DEFAULT 'both' CHECK (audience IN ('members', 'alumni', 'both'));
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS target_user_ids uuid[];

-- Enable RLS on new table
ALTER TABLE public.org_philanthropy_embeds ENABLE ROW LEVEL SECURITY;

-- RLS Policies for Philanthropy Embeds
DROP POLICY IF EXISTS org_philanthropy_embeds_select ON public.org_philanthropy_embeds;
CREATE POLICY org_philanthropy_embeds_select
  ON public.org_philanthropy_embeds
  FOR SELECT USING (has_active_role(organization_id, array['admin','active_member','alumni']));

DROP POLICY IF EXISTS org_philanthropy_embeds_insert ON public.org_philanthropy_embeds;
CREATE POLICY org_philanthropy_embeds_insert
  ON public.org_philanthropy_embeds
  FOR INSERT WITH CHECK (has_active_role(organization_id, array['admin']));

DROP POLICY IF EXISTS org_philanthropy_embeds_update ON public.org_philanthropy_embeds;
CREATE POLICY org_philanthropy_embeds_update
  ON public.org_philanthropy_embeds
  FOR UPDATE USING (has_active_role(organization_id, array['admin']))
  WITH CHECK (has_active_role(organization_id, array['admin']));

DROP POLICY IF EXISTS org_philanthropy_embeds_delete ON public.org_philanthropy_embeds;
CREATE POLICY org_philanthropy_embeds_delete
  ON public.org_philanthropy_embeds
  FOR DELETE USING (has_active_role(organization_id, array['admin']));

-- RLS Policies for Announcements (Admin-only write)
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS announcements_select ON public.announcements;
CREATE POLICY announcements_select
  ON public.announcements
  FOR SELECT USING (has_active_role(organization_id, array['admin','active_member','alumni']));

DROP POLICY IF EXISTS announcements_insert ON public.announcements;
CREATE POLICY announcements_insert
  ON public.announcements
  FOR INSERT WITH CHECK (has_active_role(organization_id, array['admin']));

DROP POLICY IF EXISTS announcements_update ON public.announcements;
CREATE POLICY announcements_update
  ON public.announcements
  FOR UPDATE USING (has_active_role(organization_id, array['admin']))
  WITH CHECK (has_active_role(organization_id, array['admin']));

DROP POLICY IF EXISTS announcements_delete ON public.announcements;
CREATE POLICY announcements_delete
  ON public.announcements
  FOR DELETE USING (has_active_role(organization_id, array['admin']));

-- RLS Policies for Events (Admin-only write)
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS events_select ON public.events;
CREATE POLICY events_select
  ON public.events
  FOR SELECT USING (has_active_role(organization_id, array['admin','active_member','alumni']));

DROP POLICY IF EXISTS events_insert ON public.events;
CREATE POLICY events_insert
  ON public.events
  FOR INSERT WITH CHECK (has_active_role(organization_id, array['admin']));

DROP POLICY IF EXISTS events_update ON public.events;
CREATE POLICY events_update
  ON public.events
  FOR UPDATE USING (has_active_role(organization_id, array['admin']))
  WITH CHECK (has_active_role(organization_id, array['admin']));

DROP POLICY IF EXISTS events_delete ON public.events;
CREATE POLICY events_delete
  ON public.events
  FOR DELETE USING (has_active_role(organization_id, array['admin']));

-- RLS for organization_invites (admin-only management)
ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_invites_select ON public.organization_invites;
CREATE POLICY organization_invites_select
  ON public.organization_invites
  FOR SELECT USING (has_active_role(organization_id, array['admin']));

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




