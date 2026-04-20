-- Phase 4 (C1): Unified DSR intake + SLA tracking for FERPA / NY Ed Law 2-d
--
-- This table becomes the source of truth for rights-request intake and routing.
-- Existing execution/audit tables (user_deletion_requests, data_access_log) remain
-- in place and may be linked from this table.

CREATE TABLE public.dsr_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id),
  school_owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subject_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subject_identifier TEXT,
  subject_identifier_type TEXT CHECK (
    subject_identifier_type IS NULL
    OR subject_identifier_type IN ('email', 'student_id', 'alumni_id')
  ),
  requester_name TEXT,
  requester_email TEXT,
  requester_relationship TEXT NOT NULL CHECK (
    requester_relationship IN (
      'student',
      'eligible_student',
      'parent',
      'guardian',
      'school_official',
      'administrator',
      'other'
    )
  ),
  request_type TEXT NOT NULL CHECK (
    request_type IN ('inspect', 'correct', 'delete', 'export')
  ),
  source TEXT NOT NULL CHECK (
    source IN ('parent_direct', 'school_relay', 'student_self', 'admin_entered')
  ),
  status TEXT NOT NULL DEFAULT 'received' CHECK (
    status IN ('received', 'acknowledged', 'in_progress', 'resolved', 'cancelled')
  ),
  acknowledgement_method TEXT CHECK (
    acknowledgement_method IS NULL
    OR acknowledgement_method IN ('email', 'portal', 'school_relay', 'phone', 'in_person', 'other')
  ),
  resolution_method TEXT CHECK (
    resolution_method IS NULL
    OR resolution_method IN ('email', 'portal', 'school_relay', 'phone', 'in_person', 'other')
  ),
  received_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  ack_due_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now()) + interval '10 days'),
  resolve_due_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now()) + interval '45 days'),
  resolution_notes TEXT,
  linked_deletion_request_id UUID REFERENCES public.user_deletion_requests(id) ON DELETE SET NULL,
  linked_access_log_id UUID REFERENCES public.data_access_log(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CHECK (subject_user_id IS NOT NULL OR subject_identifier IS NOT NULL),
  CHECK (ack_due_at >= received_at),
  CHECK (resolve_due_at >= ack_due_at),
  CHECK (acknowledged_at IS NULL OR acknowledged_at >= received_at),
  CHECK (resolved_at IS NULL OR resolved_at >= received_at)
);

CREATE INDEX dsr_requests_org_status_idx
  ON public.dsr_requests (organization_id, status, received_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX dsr_requests_ack_due_idx
  ON public.dsr_requests (organization_id, ack_due_at)
  WHERE deleted_at IS NULL
    AND acknowledged_at IS NULL
    AND status IN ('received', 'acknowledged', 'in_progress');

CREATE INDEX dsr_requests_resolve_due_idx
  ON public.dsr_requests (organization_id, resolve_due_at)
  WHERE deleted_at IS NULL
    AND resolved_at IS NULL
    AND status IN ('acknowledged', 'in_progress');

CREATE INDEX dsr_requests_subject_user_idx
  ON public.dsr_requests (subject_user_id, received_at DESC);

COMMENT ON TABLE public.dsr_requests IS
  'Unified FERPA/COPPA/NY rights-request intake log with routing evidence, SLA dates, and links to execution records.';

COMMENT ON COLUMN public.dsr_requests.organization_id IS
  'Nullable for platform-level self-service requests; set for school-routed FERPA requests.';

COMMENT ON COLUMN public.dsr_requests.school_owner_user_id IS
  'School-side owner responsible for the request when the request is routed through an educational agency.';

COMMENT ON COLUMN public.dsr_requests.source IS
  'How the request entered the system: parent direct, school relay, student self-service, or admin-entered.';

COMMENT ON COLUMN public.dsr_requests.deleted_at IS
  'Soft-delete marker for misfiled requests; preserves audit evidence without showing the row in standard admin views.';

CREATE OR REPLACE FUNCTION public.has_dsr_compliance_role()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT auth.jwt() ->> 'app_role') = 'compliance'
    OR (SELECT auth.jwt() -> 'app_metadata' ->> 'app_role') = 'compliance'
    OR (SELECT auth.jwt() -> 'app_metadata' ->> 'compliance_role') = 'true'
    OR (SELECT auth.jwt() -> 'user_metadata' ->> 'app_role') = 'compliance',
    false
  );
$$;

ALTER TABLE public.dsr_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dsr_requests_admin_read ON public.dsr_requests;
CREATE POLICY dsr_requests_admin_read ON public.dsr_requests
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND organization_id IS NOT NULL
    AND public.is_org_admin(organization_id)
  );

DROP POLICY IF EXISTS dsr_requests_compliance_read ON public.dsr_requests;
CREATE POLICY dsr_requests_compliance_read ON public.dsr_requests
  FOR SELECT TO authenticated
  USING (public.has_dsr_compliance_role());

DROP POLICY IF EXISTS dsr_requests_service_only ON public.dsr_requests;
CREATE POLICY dsr_requests_service_only ON public.dsr_requests
  FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

DROP TRIGGER IF EXISTS dsr_requests_updated_at ON public.dsr_requests;
CREATE TRIGGER dsr_requests_updated_at
  BEFORE UPDATE ON public.dsr_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.get_dsr_requests_due_soon(
  p_org_id UUID,
  p_window_days INTEGER DEFAULT 7
)
RETURNS TABLE (
  id UUID,
  organization_id UUID,
  school_owner_user_id UUID,
  requester_name TEXT,
  requester_email TEXT,
  requester_relationship TEXT,
  request_type TEXT,
  source TEXT,
  status TEXT,
  received_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  ack_due_at TIMESTAMPTZ,
  resolve_due_at TIMESTAMPTZ,
  due_phase TEXT,
  due_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH open_requests AS (
    SELECT
      dr.id,
      dr.organization_id,
      dr.school_owner_user_id,
      dr.requester_name,
      dr.requester_email,
      dr.requester_relationship,
      dr.request_type,
      dr.source,
      dr.status,
      dr.received_at,
      dr.acknowledged_at,
      dr.ack_due_at,
      dr.resolve_due_at,
      CASE
        WHEN dr.acknowledged_at IS NULL THEN 'acknowledgement'
        ELSE 'resolution'
      END AS due_phase,
      CASE
        WHEN dr.acknowledged_at IS NULL THEN dr.ack_due_at
        ELSE dr.resolve_due_at
      END AS due_at,
      CASE
        WHEN dr.acknowledged_at IS NULL
          THEN dr.received_at + ((dr.ack_due_at - dr.received_at) * 0.75)
        ELSE dr.received_at + ((dr.resolve_due_at - dr.received_at) * 0.75)
      END AS escalation_threshold
    FROM public.dsr_requests dr
    WHERE dr.deleted_at IS NULL
      AND dr.organization_id = p_org_id
      AND dr.status IN ('received', 'acknowledged', 'in_progress')
      AND dr.resolved_at IS NULL
  )
  SELECT
    open_requests.id,
    open_requests.organization_id,
    open_requests.school_owner_user_id,
    open_requests.requester_name,
    open_requests.requester_email,
    open_requests.requester_relationship,
    open_requests.request_type,
    open_requests.source,
    open_requests.status,
    open_requests.received_at,
    open_requests.acknowledged_at,
    open_requests.ack_due_at,
    open_requests.resolve_due_at,
    open_requests.due_phase,
    open_requests.due_at
  FROM open_requests
  WHERE now() >= open_requests.escalation_threshold
    AND open_requests.due_at <= now() + make_interval(days => GREATEST(COALESCE(p_window_days, 7), 0))
  ORDER BY open_requests.due_at ASC, open_requests.received_at ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_dsr_requests_due_soon(UUID, INTEGER) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_dsr_requests_due_soon(UUID, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_dsr_requests_due_soon(UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_dsr_requests_due_soon(UUID, INTEGER) TO service_role;
