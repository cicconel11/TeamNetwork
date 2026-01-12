-- =====================================================
-- Migration: Group Chat with Admin Approval
-- =====================================================

-- Create message status enum
DO $$
BEGIN
  CREATE TYPE public.chat_message_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Create group member role enum
DO $$
BEGIN
  CREATE TYPE public.chat_group_role AS ENUM ('admin', 'moderator', 'member');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================
-- Table: chat_groups
-- =====================================================
CREATE TABLE IF NOT EXISTS public.chat_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_default boolean NOT NULL DEFAULT false,
  require_approval boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS chat_groups_org_idx ON public.chat_groups(organization_id);
CREATE INDEX IF NOT EXISTS chat_groups_org_default_idx ON public.chat_groups(organization_id, is_default) WHERE deleted_at IS NULL;

-- =====================================================
-- Table: chat_group_members
-- =====================================================
CREATE TABLE IF NOT EXISTS public.chat_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role public.chat_group_role NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  UNIQUE(chat_group_id, user_id)
);

CREATE INDEX IF NOT EXISTS chat_group_members_group_idx ON public.chat_group_members(chat_group_id);
CREATE INDEX IF NOT EXISTS chat_group_members_user_idx ON public.chat_group_members(user_id);
CREATE INDEX IF NOT EXISTS chat_group_members_org_idx ON public.chat_group_members(organization_id);

-- =====================================================
-- Table: chat_messages
-- =====================================================
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  status public.chat_message_status NOT NULL DEFAULT 'approved',
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  edited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS chat_messages_group_idx ON public.chat_messages(chat_group_id);
CREATE INDEX IF NOT EXISTS chat_messages_org_idx ON public.chat_messages(organization_id);
CREATE INDEX IF NOT EXISTS chat_messages_author_idx ON public.chat_messages(author_id);
CREATE INDEX IF NOT EXISTS chat_messages_created_idx ON public.chat_messages(chat_group_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS chat_messages_pending_idx ON public.chat_messages(organization_id, status) WHERE status = 'pending' AND deleted_at IS NULL;

-- =====================================================
-- Updated_at triggers
-- =====================================================
DROP TRIGGER IF EXISTS chat_groups_updated_at ON public.chat_groups;
CREATE TRIGGER chat_groups_updated_at
  BEFORE UPDATE ON public.chat_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Helper function: check if user is group member
-- =====================================================
CREATE OR REPLACE FUNCTION public.is_chat_group_member(group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_group_members cgm
    WHERE cgm.chat_group_id = group_id
      AND cgm.user_id = auth.uid()
  );
$$;

-- =====================================================
-- Helper function: check if user is group admin/mod
-- =====================================================
CREATE OR REPLACE FUNCTION public.is_chat_group_moderator(group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_group_members cgm
    WHERE cgm.chat_group_id = group_id
      AND cgm.user_id = auth.uid()
      AND cgm.role IN ('admin', 'moderator')
  );
$$;

-- =====================================================
-- Enable RLS
-- =====================================================
ALTER TABLE public.chat_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- RLS Policies: chat_groups
-- =====================================================
-- Members of org can view groups they belong to (or all if org admin)
DROP POLICY IF EXISTS chat_groups_select ON public.chat_groups;
CREATE POLICY chat_groups_select ON public.chat_groups
  FOR SELECT USING (
    deleted_at IS NULL
    AND has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND (
      has_active_role(organization_id, array['admin'])
      OR is_chat_group_member(id)
    )
  );

-- Only org admins can create groups
DROP POLICY IF EXISTS chat_groups_insert ON public.chat_groups;
CREATE POLICY chat_groups_insert ON public.chat_groups
  FOR INSERT WITH CHECK (
    has_active_role(organization_id, array['admin'])
  );

-- Only org admins can update groups
DROP POLICY IF EXISTS chat_groups_update ON public.chat_groups;
CREATE POLICY chat_groups_update ON public.chat_groups
  FOR UPDATE USING (
    has_active_role(organization_id, array['admin'])
  );

-- Only org admins can delete groups
DROP POLICY IF EXISTS chat_groups_delete ON public.chat_groups;
CREATE POLICY chat_groups_delete ON public.chat_groups
  FOR DELETE USING (
    has_active_role(organization_id, array['admin'])
  );

-- =====================================================
-- RLS Policies: chat_group_members
-- =====================================================
-- Members can see other members in groups they belong to
DROP POLICY IF EXISTS chat_group_members_select ON public.chat_group_members;
CREATE POLICY chat_group_members_select ON public.chat_group_members
  FOR SELECT USING (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND (
      has_active_role(organization_id, array['admin'])
      OR is_chat_group_member(chat_group_id)
    )
  );

-- Org admins or group admins can add members
DROP POLICY IF EXISTS chat_group_members_insert ON public.chat_group_members;
CREATE POLICY chat_group_members_insert ON public.chat_group_members
  FOR INSERT WITH CHECK (
    has_active_role(organization_id, array['admin'])
    OR is_chat_group_moderator(chat_group_id)
  );

-- Org admins or group admins can update member roles
DROP POLICY IF EXISTS chat_group_members_update ON public.chat_group_members;
CREATE POLICY chat_group_members_update ON public.chat_group_members
  FOR UPDATE USING (
    has_active_role(organization_id, array['admin'])
    OR is_chat_group_moderator(chat_group_id)
  );

-- Org admins, group admins, or self can remove membership
DROP POLICY IF EXISTS chat_group_members_delete ON public.chat_group_members;
CREATE POLICY chat_group_members_delete ON public.chat_group_members
  FOR DELETE USING (
    has_active_role(organization_id, array['admin'])
    OR is_chat_group_moderator(chat_group_id)
    OR user_id = auth.uid()
  );

-- =====================================================
-- RLS Policies: chat_messages
-- =====================================================
-- Members can see approved messages + their own pending + mods see all pending
DROP POLICY IF EXISTS chat_messages_select ON public.chat_messages;
CREATE POLICY chat_messages_select ON public.chat_messages
  FOR SELECT USING (
    deleted_at IS NULL
    AND has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND is_chat_group_member(chat_group_id)
    AND (
      status = 'approved'
      OR author_id = auth.uid()
      OR is_chat_group_moderator(chat_group_id)
      OR has_active_role(organization_id, array['admin'])
    )
  );

-- Members can insert messages (status depends on group settings, handled in app)
DROP POLICY IF EXISTS chat_messages_insert ON public.chat_messages;
CREATE POLICY chat_messages_insert ON public.chat_messages
  FOR INSERT WITH CHECK (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND is_chat_group_member(chat_group_id)
    AND author_id = auth.uid()
  );

-- Only moderators/admins can update messages (for approval), or author can edit body
DROP POLICY IF EXISTS chat_messages_update ON public.chat_messages;
CREATE POLICY chat_messages_update ON public.chat_messages
  FOR UPDATE USING (
    deleted_at IS NULL
    AND has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND (
      is_chat_group_moderator(chat_group_id)
      OR has_active_role(organization_id, array['admin'])
      OR author_id = auth.uid()
    )
  );

-- Only mods/admins or author can soft-delete messages
DROP POLICY IF EXISTS chat_messages_delete ON public.chat_messages;
CREATE POLICY chat_messages_delete ON public.chat_messages
  FOR DELETE USING (
    has_active_role(organization_id, array['admin'])
    OR is_chat_group_moderator(chat_group_id)
    OR author_id = auth.uid()
  );

-- =====================================================
-- Grant permissions
-- =====================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_group_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO authenticated;

-- =====================================================
-- Enable Realtime for chat_messages
-- =====================================================
-- Set REPLICA IDENTITY FULL so Realtime broadcasts all columns
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
