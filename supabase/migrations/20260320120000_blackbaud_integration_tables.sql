-- =============================================================
-- Blackbaud / CRM Integration Tables
-- =============================================================

-- 1. org_integrations: stores OAuth connections per org per provider
CREATE TABLE IF NOT EXISTS public.org_integrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider        text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','active','error','disconnected')),
  access_token_enc  text,
  refresh_token_enc text,
  token_expires_at  timestamptz,
  provider_config   jsonb NOT NULL DEFAULT '{}',
  connected_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_synced_at    timestamptz,
  last_sync_error   jsonb,
  last_sync_count   integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, provider)
);

-- 2. alumni_external_ids: provider-agnostic external ID mapping
CREATE TABLE IF NOT EXISTS public.alumni_external_ids (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alumni_id       uuid NOT NULL REFERENCES public.alumni(id) ON DELETE CASCADE,
  integration_id  uuid NOT NULL REFERENCES public.org_integrations(id) ON DELETE CASCADE,
  external_id     text NOT NULL,
  external_data   jsonb,
  last_synced_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(integration_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_alumni_external_ids_alumni
  ON public.alumni_external_ids(alumni_id);

-- 3. integration_sync_log: audit trail for sync operations
CREATE TABLE IF NOT EXISTS public.integration_sync_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id    uuid NOT NULL REFERENCES public.org_integrations(id) ON DELETE CASCADE,
  sync_type         text NOT NULL CHECK (sync_type IN ('full','incremental','manual')),
  status            text NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','completed','failed')),
  records_created   integer NOT NULL DEFAULT 0,
  records_updated   integer NOT NULL DEFAULT 0,
  records_unchanged integer NOT NULL DEFAULT 0,
  records_skipped   integer NOT NULL DEFAULT 0,
  error_message     text,
  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz
);

-- 4. OAuth state table (separate from live integration to avoid disrupting active connections)
CREATE TABLE IF NOT EXISTS public.org_integration_oauth_state (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider        text NOT NULL,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redirect_path   text,
  initiated_at    timestamptz NOT NULL DEFAULT now(),
  used            boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_oauth_state_cleanup
  ON public.org_integration_oauth_state(initiated_at);

-- RLS for oauth_state (service role only — no client access needed)
ALTER TABLE public.org_integration_oauth_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "oauth_state_service_role"
  ON public.org_integration_oauth_state FOR ALL
  USING (auth.role() = 'service_role');

-- 5. Add provider-agnostic columns to alumni
ALTER TABLE public.alumni
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS address_summary text;

-- 6. RLS policies for org_integrations
ALTER TABLE public.org_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_integrations_select_org_member"
  ON public.org_integrations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_organization_roles r
      WHERE r.organization_id = org_integrations.organization_id
        AND r.user_id = auth.uid()
        AND r.status = 'active'
    )
  );

CREATE POLICY "org_integrations_insert_org_admin"
  ON public.org_integrations FOR INSERT
  WITH CHECK (
    is_org_admin(organization_id)
  );

CREATE POLICY "org_integrations_update_org_admin"
  ON public.org_integrations FOR UPDATE
  USING (
    is_org_admin(organization_id)
  );

CREATE POLICY "org_integrations_delete_org_admin"
  ON public.org_integrations FOR DELETE
  USING (
    is_org_admin(organization_id)
  );

-- Service role bypass for cron/sync operations
CREATE POLICY "org_integrations_service_role"
  ON public.org_integrations FOR ALL
  USING (auth.role() = 'service_role');

-- 7. RLS policies for alumni_external_ids
ALTER TABLE public.alumni_external_ids ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alumni_external_ids_select_org_member"
  ON public.alumni_external_ids FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.org_integrations i
      JOIN public.user_organization_roles r
        ON r.organization_id = i.organization_id
      WHERE i.id = alumni_external_ids.integration_id
        AND r.user_id = auth.uid()
        AND r.status = 'active'
    )
  );

CREATE POLICY "alumni_external_ids_service_role"
  ON public.alumni_external_ids FOR ALL
  USING (auth.role() = 'service_role');

-- 8. RLS policies for integration_sync_log
ALTER TABLE public.integration_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "integration_sync_log_select_org_admin"
  ON public.integration_sync_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.org_integrations i
      WHERE i.id = integration_sync_log.integration_id
        AND is_org_admin(i.organization_id)
    )
  );

CREATE POLICY "integration_sync_log_service_role"
  ON public.integration_sync_log FOR ALL
  USING (auth.role() = 'service_role');
