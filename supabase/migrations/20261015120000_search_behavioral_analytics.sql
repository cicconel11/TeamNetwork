-- Redacted search telemetry (no raw query text; no content IDs in props).

ALTER TYPE public.analytics_event_name ADD VALUE IF NOT EXISTS 'search_used';
ALTER TYPE public.analytics_event_name ADD VALUE IF NOT EXISTS 'search_result_click';

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
  v_age_bracket TEXT;
  v_org_type TEXT;
  v_num numeric;
BEGIN
  IF NOT public.check_analytics_rate_limit(auth.uid(), p_org_id, 50, '1 hour'::interval) THEN
    RETURN FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.analytics_consent ac
    WHERE ac.org_id = p_org_id
      AND ac.user_id = auth.uid()
      AND ac.consent_state = 'opted_in'
  ) THEN
    RETURN FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_organization_roles uor
    WHERE uor.organization_id = p_org_id
      AND uor.user_id = auth.uid()
      AND uor.status = 'active'::public.membership_status
  ) THEN
    RETURN FALSE;
  END IF;

  SELECT CASE
    WHEN au.raw_user_meta_data ->> 'age_bracket' IN ('under_13', '13_17', '18_plus')
      THEN au.raw_user_meta_data ->> 'age_bracket'
    ELSE NULL
  END
  INTO v_age_bracket
  FROM auth.users au
  WHERE au.id = auth.uid();

  SELECT COALESCE(o.org_type, 'general')
  INTO v_org_type
  FROM public.organizations o
  WHERE o.id = p_org_id;

  IF COALESCE(v_age_bracket, '') = 'under_13' THEN
    RETURN FALSE;
  END IF;

  IF (v_age_bracket = '13_17' OR v_org_type = 'educational')
     AND p_event_name NOT IN ('app_open', 'route_view') THEN
    RETURN FALSE;
  END IF;

  allowed_keys := CASE p_event_name
    WHEN 'route_view' THEN ARRAY['screen','feature']
    WHEN 'nav_click' THEN ARRAY['destination_route','nav_surface','position']
    WHEN 'page_dwell_bucket' THEN ARRAY['screen','feature','dwell_bucket']
    WHEN 'directory_view' THEN ARRAY['directory_type']
    WHEN 'directory_filter_apply' THEN ARRAY['directory_type','filter_keys','filters_count']
    WHEN 'profile_card_open' THEN ARRAY['directory_type','open_source']
    WHEN 'events_view' THEN ARRAY['view_mode']
    WHEN 'event_open' THEN ARRAY['event_id','open_source']
    WHEN 'rsvp_update' THEN ARRAY['event_id','rsvp_status']
    WHEN 'donation_flow_start' THEN ARRAY['campaign_id']
    WHEN 'donation_checkout_start' THEN ARRAY['campaign_id','amount_bucket']
    WHEN 'donation_checkout_result' THEN ARRAY['campaign_id','result','error_code']
    WHEN 'chat_thread_open' THEN ARRAY['thread_id','open_source']
    WHEN 'chat_message_send' THEN ARRAY['thread_id','message_type','result','error_code']
    WHEN 'chat_participants_change' THEN ARRAY['thread_id','action','delta_count','result']
    WHEN 'search_used' THEN ARRAY['query_length','result_count','mode']
    WHEN 'search_result_click' THEN ARRAY['query_length','mode','clicked_entity_type','result_position']
    ELSE ARRAY[]::TEXT[]
  END;
  allowed_keys := allowed_keys || ARRAY['referrer_type','consent_state'];

  FOR kv IN SELECT * FROM jsonb_each(p_props) LOOP
    v_key := kv.key;
    v_val := kv.value;

    IF NOT (v_key = ANY (allowed_keys)) THEN
      CONTINUE;
    END IF;

    IF v_key ILIKE '%email%'
       OR (v_key ILIKE '%name%' AND v_key NOT IN ('clicked_entity_type'))
       OR (v_key ILIKE '%message%' AND v_key <> 'message_type')
       OR (v_key ILIKE '%query%' AND v_key <> 'query_length')
       OR v_key ILIKE '%url%'
       OR v_key ILIKE '%file%'
       OR v_key ILIKE '%phone%' THEN
      RETURN FALSE;
    END IF;

    IF v_key IN ('message_type')
       AND jsonb_typeof(v_val) <> 'string' THEN
      RETURN FALSE;
    END IF;

    IF jsonb_typeof(v_val) = 'string' THEN
      v_str := trim(both '"' from v_val::text);

      IF v_key = 'message_type' AND v_str NOT IN ('text', 'poll', 'form') THEN
        RETURN FALSE;
      END IF;

      IF v_key = 'mode' AND v_str NOT IN ('fast', 'ai') THEN
        RETURN FALSE;
      END IF;

      IF length(v_val::text) > 66 THEN
        RETURN FALSE;
      END IF;
    ELSIF jsonb_typeof(v_val) = 'array' THEN
      IF v_key <> 'filter_keys' THEN
        RETURN FALSE;
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_val) AS t(val)
        WHERE length(t.val) > 66
      ) THEN
        RETURN FALSE;
      END IF;
    ELSIF jsonb_typeof(v_val) = 'number' THEN
      v_num := (v_val::text)::numeric;
      IF v_key = 'query_length' AND (v_num < 0 OR v_num > 500) THEN
        RETURN FALSE;
      END IF;
      IF v_key = 'result_count' AND (v_num < 0 OR v_num > 500) THEN
        RETURN FALSE;
      END IF;
      IF v_key = 'result_position' AND (v_num < 0 OR v_num > 200) THEN
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
