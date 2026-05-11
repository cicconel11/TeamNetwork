CREATE TABLE IF NOT EXISTS public.org_member_role_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  pending_action_id uuid REFERENCES public.ai_pending_actions(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('manual', 'ai_pending_action')),
  previous_role public.user_role NOT NULL,
  new_role public.user_role NOT NULL,
  previous_status public.membership_status NOT NULL,
  new_status public.membership_status NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_member_role_audit_org_created_idx
  ON public.org_member_role_audit (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS org_member_role_audit_pending_action_idx
  ON public.org_member_role_audit (pending_action_id)
  WHERE pending_action_id IS NOT NULL;

ALTER TABLE public.org_member_role_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_member_role_audit_admin_select ON public.org_member_role_audit;
CREATE POLICY org_member_role_audit_admin_select
  ON public.org_member_role_audit
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_organization_roles uor
      WHERE uor.organization_id = org_member_role_audit.organization_id
        AND uor.user_id = auth.uid()
        AND uor.role = 'admin'
        AND uor.status = 'active'
    )
  );

DROP POLICY IF EXISTS org_member_role_audit_service_all ON public.org_member_role_audit;
CREATE POLICY org_member_role_audit_service_all
  ON public.org_member_role_audit
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
