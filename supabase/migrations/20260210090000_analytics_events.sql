-- COPPA/FERPA-minimal analytics + ops telemetry

-- =============================================================================
-- Types
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'analytics_consent_state') THEN
    CREATE TYPE public.analytics_consent_state AS ENUM ('opted_in', 'opted_out');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'analytics_event_name') THEN
    CREATE TYPE public.analytics_event_name AS ENUM (
      'app_open','route_view','nav_click','cta_click','page_dwell_bucket',
      'directory_view','directory_filter_apply','directory_sort_change','profile_card_open',
      'events_view','event_open','rsvp_update',
      'form_open','form_submit','file_upload_attempt',
      'donation_flow_start','donation_checkout_start','donation_checkout_result',
      'chat_thread_open','chat_message_send','chat_participants_change'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ops_event_name') THEN
    CREATE TYPE public.ops_event_name AS ENUM ('api_error','client_error','auth_fail','rate_limited');
  END IF;
END
$$;

-- =============================================================================
-- Table: analytics_consent (per org/user)
-- =============================================================================
DROP TABLE IF EXISTS public.analytics_consent;

CREATE TABLE public.analytics_consent (
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_state public.analytics_consent_state NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

ALTER TABLE public.analytics_consent ENABLE ROW LEVEL SECURITY;

-- Users can read/write their own consent if they are active members of the org
DROP POLICY IF EXISTS analytics_consent_select ON public.analytics_consent;
CREATE POLICY analytics_consent_select
  ON public.analytics_consent FOR SELECT
  USING (
    user_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.user_organization_roles uor
      WHERE uor.organization_id = org_id
        AND uor.user_id = auth.uid()
        AND uor.status = 'active'::public.membership_status
    )
  );

DROP POLICY IF EXISTS analytics_consent_upsert ON public.analytics_consent;
CREATE POLICY analytics_consent_upsert
  ON public.analytics_consent FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.user_organization_roles uor
      WHERE uor.organization_id = org_id
        AND uor.user_id = auth.uid()
        AND uor.status = 'active'::public.membership_status
    )
  );

DROP POLICY IF EXISTS analytics_consent_update ON public.analytics_consent;
CREATE POLICY analytics_consent_update
  ON public.analytics_consent FOR UPDATE
  USING (
    user_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.user_organization_roles uor
      WHERE uor.organization_id = org_id
        AND uor.user_id = auth.uid()
        AND uor.status = 'active'::public.membership_status
    )
  )
  WITH CHECK (
    user_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.user_organization_roles uor
      WHERE uor.organization_id = org_id
        AND uor.user_id = auth.uid()
        AND uor.status = 'active'::public.membership_status
    )
  );

-- =============================================================================
-- Table: analytics_events (behavioral; consent required)
-- =============================================================================
DROP TABLE IF EXISTS public.analytics_events;

CREATE TABLE public.analytics_events (
  id BIGSERIAL PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  client_day DATE NOT NULL,
  platform TEXT NOT NULL,
  device_class TEXT NOT NULL,
  app_version TEXT NOT NULL,
  route TEXT NOT NULL,
  event_name public.analytics_event_name NOT NULL,
  props JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
-- No policies: inserts only via SECURITY DEFINER RPC.

-- =============================================================================
-- Table: ops_events (allowed without consent; minimal)
-- =============================================================================
DROP TABLE IF EXISTS public.ops_events;

CREATE TABLE public.ops_events (
  id BIGSERIAL PRIMARY KEY,
  org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  session_id UUID,
  client_day DATE NOT NULL,
  platform TEXT NOT NULL,
  device_class TEXT NOT NULL,
  app_version TEXT NOT NULL,
  route TEXT NOT NULL,
  event_name public.ops_event_name NOT NULL,
  endpoint_group TEXT,
  http_status INT,
  error_code TEXT,
  retryable BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ops_events ENABLE ROW LEVEL SECURITY;
-- No policies: inserts only via SECURITY DEFINER RPC.

-- =============================================================================
-- RPC: log_analytics_event (consented)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.log_analytics_event(
  p_org_id UUID,
  p_session_id UUID,
  p_client_day DATE,
  p_platform TEXT,
  p_device_class TEXT,
  p_app_version TEXT,
  p_route TEXT,
  p_event_name public.analytics_event_name,
  p_props JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  allowed_keys TEXT[];
  sanitized JSONB := '{}'::jsonb;
  kv RECORD;
  v_key TEXT;
  v_val JSONB;
  v_str TEXT;
BEGIN
  -- Consent check
  IF NOT EXISTS (
    SELECT 1 FROM public.analytics_consent ac
    WHERE ac.org_id = p_org_id
      AND ac.user_id = auth.uid()
      AND ac.consent_state = 'opted_in'
  ) THEN
    RETURN FALSE;
  END IF;

  -- Membership check (defense in depth)
  IF NOT EXISTS (
    SELECT 1 FROM public.user_organization_roles uor
    WHERE uor.organization_id = p_org_id
      AND uor.user_id = auth.uid()
      AND uor.status = 'active'::public.membership_status
  ) THEN
    RETURN FALSE;
  END IF;

  -- Per-event allowlist
  allowed_keys := CASE p_event_name
    WHEN 'route_view' THEN ARRAY['screen','feature']
    WHEN 'nav_click' THEN ARRAY['destination_route','nav_surface','position']
    WHEN 'cta_click' THEN ARRAY['cta','feature','surface','position']
    WHEN 'page_dwell_bucket' THEN ARRAY['screen','feature','dwell_bucket']
    WHEN 'directory_view' THEN ARRAY['directory_type']
    WHEN 'directory_filter_apply' THEN ARRAY['directory_type','filter_keys','filters_count']
    WHEN 'directory_sort_change' THEN ARRAY['directory_type','sort_key']
    WHEN 'profile_card_open' THEN ARRAY['directory_type','open_source']
    WHEN 'events_view' THEN ARRAY['view_mode']
    WHEN 'event_open' THEN ARRAY['event_id','open_source']
    WHEN 'rsvp_update' THEN ARRAY['event_id','rsvp_status']
    WHEN 'form_open' THEN ARRAY['form_id','open_source']
    WHEN 'form_submit' THEN ARRAY['form_id','result','duration_bucket','error_code']
    WHEN 'file_upload_attempt' THEN ARRAY['file_type','file_size_bucket','result','error_code']
    WHEN 'donation_flow_start' THEN ARRAY['campaign_id']
    WHEN 'donation_checkout_start' THEN ARRAY['campaign_id','amount_bucket']
    WHEN 'donation_checkout_result' THEN ARRAY['campaign_id','result','error_code']
    WHEN 'chat_thread_open' THEN ARRAY['thread_id','open_source']
    WHEN 'chat_message_send' THEN ARRAY['thread_id','message_type','result','error_code']
    WHEN 'chat_participants_change' THEN ARRAY['thread_id','action','delta_count','result']
    ELSE ARRAY[]::TEXT[]
  END;
  allowed_keys := allowed_keys || ARRAY['referrer_type','consent_state'];

  -- Sanitize props
  FOR kv IN SELECT * FROM jsonb_each(p_props) LOOP
    v_key := kv.key;
    v_val := kv.value;

    -- Hard block suspicious keys
    IF v_key ILIKE '%email%' OR v_key ILIKE '%name%' OR v_key ILIKE '%message%'
       OR v_key ILIKE '%query%' OR v_key ILIKE '%url%' OR v_key ILIKE '%file%'
       OR v_key ILIKE '%phone%' THEN
      RETURN FALSE;
    END IF;

    -- Allowlist only
    IF NOT (v_key = ANY (allowed_keys)) THEN
      CONTINUE;
    END IF;

    -- Enforce primitive/array value constraints
    IF jsonb_typeof(v_val) = 'string' THEN
      v_str := v_val::text;
      IF length(v_str) > 66 THEN
        RETURN FALSE;
      END IF;
    ELSIF jsonb_typeof(v_val) = 'array' THEN
      -- arrays allowed only for filter_keys
      IF v_key <> 'filter_keys' THEN
        RETURN FALSE;
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_val) AS t(val)
        WHERE length(t.val) > 66
      ) THEN
        RETURN FALSE;
      END IF;
    ELSIF jsonb_typeof(v_val) NOT IN ('number','boolean','null') THEN
      RETURN FALSE;
    END IF;

    sanitized := sanitized || jsonb_build_object(v_key, v_val);
  END LOOP;

  INSERT INTO public.analytics_events (
    org_id, session_id, client_day, platform, device_class, app_version, route, event_name, props
  ) VALUES (
    p_org_id, p_session_id, p_client_day, p_platform, p_device_class, p_app_version, p_route, p_event_name, sanitized
  );

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_analytics_event(UUID,UUID,DATE,TEXT,TEXT,TEXT,TEXT,public.analytics_event_name,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_analytics_event(UUID,UUID,DATE,TEXT,TEXT,TEXT,TEXT,public.analytics_event_name,JSONB) TO authenticated;

-- =============================================================================
-- RPC: log_ops_event (no consent required)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.log_ops_event(
  p_org_id UUID,
  p_session_id UUID,
  p_client_day DATE,
  p_platform TEXT,
  p_device_class TEXT,
  p_app_version TEXT,
  p_route TEXT,
  p_event_name public.ops_event_name,
  p_endpoint_group TEXT,
  p_http_status INT,
  p_error_code TEXT,
  p_retryable BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Basic validation
  IF p_platform NOT IN ('web','ios','android') THEN
    RETURN FALSE;
  END IF;
  IF p_device_class NOT IN ('mobile','desktop','tablet') THEN
    RETURN FALSE;
  END IF;
  IF p_error_code IS NOT NULL AND length(p_error_code) > 64 THEN
    RETURN FALSE;
  END IF;
  IF p_endpoint_group IS NOT NULL AND length(p_endpoint_group) > 32 THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.ops_events (
    org_id, session_id, client_day, platform, device_class, app_version, route,
    event_name, endpoint_group, http_status, error_code, retryable
  ) VALUES (
    p_org_id, p_session_id, p_client_day, p_platform, p_device_class, p_app_version, p_route,
    p_event_name, p_endpoint_group, p_http_status, p_error_code, p_retryable
  );

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_ops_event(UUID,UUID,DATE,TEXT,TEXT,TEXT,TEXT,public.ops_event_name,TEXT,INT,TEXT,BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_ops_event(UUID,UUID,DATE,TEXT,TEXT,TEXT,TEXT,public.ops_event_name,TEXT,INT,TEXT,BOOLEAN) TO authenticated;

-- =============================================================================
-- Cleanup RPCs
-- =============================================================================
CREATE OR REPLACE FUNCTION public.purge_analytics_events()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM public.analytics_events
  WHERE created_at < now() - INTERVAL '90 days';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('deleted', v_deleted);
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_ops_events()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM public.ops_events
  WHERE created_at < now() - INTERVAL '30 days';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('deleted', v_deleted);
END;
$$;
