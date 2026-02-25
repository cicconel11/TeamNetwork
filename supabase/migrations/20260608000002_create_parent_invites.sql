-- Parents directory (mirrors alumni structure; relationship replaces career fields)
-- Uses IF NOT EXISTS to be safe if Track 1 already applied a partial version.
CREATE TABLE IF NOT EXISTS public.parents (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  first_name      TEXT        NOT NULL,
  last_name       TEXT        NOT NULL,
  email           TEXT,
  phone_number    TEXT,
  photo_url       TEXT,
  linkedin_url    TEXT,
  student_name    TEXT,
  relationship    TEXT,          -- e.g. "mother", "father", "guardian", "step-parent"
  notes           TEXT,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Org-level email invites for parents
CREATE TABLE IF NOT EXISTS public.parent_invites (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email           TEXT        NOT NULL,
  code            TEXT        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  invited_by      UUID        NOT NULL REFERENCES auth.users(id),
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'accepted', 'revoked')),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  accepted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS parents_org_idx         ON public.parents(organization_id);
CREATE INDEX IF NOT EXISTS parents_org_deleted_idx ON public.parents(organization_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS parents_user_id_idx     ON public.parents(user_id);
CREATE INDEX IF NOT EXISTS parent_invites_code_idx  ON public.parent_invites(code);
CREATE INDEX IF NOT EXISTS parent_invites_org_idx   ON public.parent_invites(organization_id);
CREATE INDEX IF NOT EXISTS parents_student_name_idx ON public.parents (student_name);
CREATE INDEX IF NOT EXISTS parents_relationship_idx  ON public.parents (relationship);

-- RLS
ALTER TABLE public.parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_invites ENABLE ROW LEVEL SECURITY;

-- Read: admin + active_member (mirrors has_active_role pattern from alumni)
CREATE POLICY "parents_select" ON public.parents FOR SELECT
  USING (public.has_active_role(organization_id, ARRAY['admin'::text, 'active_member'::text]));

-- Write: admin only (API routes also enforce this; RLS is defense-in-depth)
CREATE POLICY "parents_insert" ON public.parents FOR INSERT
  WITH CHECK (public.is_org_admin(organization_id));
CREATE POLICY "parents_update" ON public.parents FOR UPDATE
  USING (public.is_org_admin(organization_id));
CREATE POLICY "parents_delete" ON public.parents FOR DELETE
  USING (public.is_org_admin(organization_id));

-- Invites: admin manages; accept route uses service client (bypasses RLS)
CREATE POLICY "parent_invites_select" ON public.parent_invites FOR SELECT
  USING (public.is_org_admin(organization_id));
CREATE POLICY "parent_invites_insert" ON public.parent_invites FOR INSERT
  WITH CHECK (public.is_org_admin(organization_id));
CREATE POLICY "parent_invites_update" ON public.parent_invites FOR UPDATE
  USING (public.is_org_admin(organization_id));
