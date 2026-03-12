-- Harden restored analytics enum props so direct RPC calls cannot store free-form strings.
-- Keep consent, allowlist, and coarse-grained value validation as the privacy boundary.

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

    -- Allowlist is the primary privacy boundary; ignore anything else.
    IF NOT (v_key = ANY (allowed_keys)) THEN
      CONTINUE;
    END IF;

    -- Explicitly preserve allowlisted coarse analytics keys while still rejecting
    -- other suspicious free-form key names if they are ever added to an allowlist.
    IF v_key ILIKE '%email%' OR v_key ILIKE '%name%'
       OR (v_key ILIKE '%message%' AND v_key <> 'message_type')
       OR v_key ILIKE '%query%' OR v_key ILIKE '%url%'
       OR (v_key ILIKE '%file%' AND v_key NOT IN ('file_type', 'file_size_bucket'))
       OR v_key ILIKE '%phone%' THEN
      RETURN FALSE;
    END IF;

    -- Enforce primitive/array value constraints
    IF jsonb_typeof(v_val) = 'string' THEN
      v_str := trim(both '"' from v_val::text);

      IF v_key = 'message_type' AND v_str NOT IN ('text', 'poll', 'form') THEN
        RETURN FALSE;
      END IF;

      IF v_key = 'file_type' AND v_str NOT IN ('image', 'pdf', 'doc', 'other') THEN
        RETURN FALSE;
      END IF;

      IF v_key = 'file_size_bucket' AND v_str NOT IN ('<1MB', '1-5MB', '5-25MB', '25MB+') THEN
        RETURN FALSE;
      END IF;

      IF length(v_val::text) > 66 THEN
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
