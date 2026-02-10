-- Rate limiting for analytics event logging
-- Prevents abuse of analytics logging endpoints

-- =============================================================================
-- Table: rate_limit_analytics — Tracking rate limit windows
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.rate_limit_analytics (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_count INT NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for rate limit lookups (user + org + recent window)
CREATE INDEX IF NOT EXISTS idx_rate_limit_analytics_lookup
  ON public.rate_limit_analytics (user_id, org_id, window_start DESC);

-- Ensure one window row per user/org/window_start (prevents concurrency duplicates)
CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limit_analytics_unique_window
  ON public.rate_limit_analytics (user_id, org_id, window_start);

-- Index to support cron cleanup by window_start
CREATE INDEX IF NOT EXISTS idx_rate_limit_analytics_window_start
  ON public.rate_limit_analytics (window_start);

-- Enable RLS
ALTER TABLE public.rate_limit_analytics ENABLE ROW LEVEL SECURITY;

-- RLS: Only service role can read/write (used by SECURITY DEFINER functions)
-- No policies = no public access

-- =============================================================================
-- Function: check_analytics_rate_limit
-- =============================================================================
CREATE OR REPLACE FUNCTION public.check_analytics_rate_limit(
  p_user_id UUID,
  p_org_id UUID,
  p_max_events INT DEFAULT 100,
  p_window_interval INTERVAL DEFAULT '1 hour'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_interval_seconds BIGINT;
  v_next_count INT;
BEGIN
  IF p_max_events IS NULL OR p_max_events <= 0 THEN
    RETURN FALSE;
  END IF;

  v_interval_seconds := EXTRACT(EPOCH FROM p_window_interval);
  IF v_interval_seconds IS NULL OR v_interval_seconds <= 0 THEN
    RAISE EXCEPTION 'p_window_interval must be > 0';
  END IF;

  -- Bucket windows by p_window_interval (fixed windows, not sliding)
  v_window_start := to_timestamp(
    floor(EXTRACT(EPOCH FROM now()) / v_interval_seconds) * v_interval_seconds
  );

  -- Atomic upsert+increment with limit enforcement (prevents races and duplicates)
  WITH upsert AS (
    INSERT INTO public.rate_limit_analytics (user_id, org_id, event_count, window_start)
    VALUES (p_user_id, p_org_id, 1, v_window_start)
    ON CONFLICT (user_id, org_id, window_start)
    DO UPDATE
      SET event_count = rate_limit_analytics.event_count + 1
      WHERE rate_limit_analytics.event_count < p_max_events
    RETURNING event_count
  )
  SELECT event_count INTO v_next_count FROM upsert;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_analytics_rate_limit(UUID, UUID, INT, INTERVAL) FROM PUBLIC;
-- Grant access to authenticated users (function is SECURITY DEFINER)
GRANT EXECUTE ON FUNCTION public.check_analytics_rate_limit(UUID, UUID, INT, INTERVAL) TO authenticated;

-- =============================================================================
-- Update log_analytics_event to include rate limiting
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
  -- Rate limit check (50 events/hour per user per org)
  IF NOT public.check_analytics_rate_limit(auth.uid(), p_org_id, 50, '1 hour'::interval) THEN
    RETURN FALSE;
  END IF;

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

-- =============================================================================
-- Update log_ops_event to include rate limiting
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
  -- Rate limit check (100 events/hour per user per org)
  -- Use org_id or generate a default UUID for unauthenticated requests
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.check_analytics_rate_limit(
      auth.uid(),
      COALESCE(p_org_id, '00000000-0000-0000-0000-000000000000'::uuid),
      100,
      '1 hour'::interval
    ) THEN
      RETURN FALSE;
    END IF;
  END IF;

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
