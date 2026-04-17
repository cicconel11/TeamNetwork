-- Global org search: visibility helpers, pg_trgm indexes, search_org_content RPC.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Directory member row visible (matches members directory linked + manual rules; dev-admin email exclusion omitted).
CREATE OR REPLACE FUNCTION public.is_member_directory_visible(
  p_member_id uuid,
  p_org_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.members m
    WHERE m.id = p_member_id
      AND m.organization_id = p_org_id
      AND m.deleted_at IS NULL
      AND (
        m.user_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.user_organization_roles uor
          WHERE uor.organization_id = p_org_id
            AND uor.user_id = m.user_id
            AND uor.status = 'active'::public.membership_status
            AND uor.role::text = ANY (
              ARRAY['admin'::text, 'active_member'::text, 'parent'::text, 'member'::text]
            )
        )
      )
  );
$$;

-- Alumni row visible to any active org member (directory is org-wide).
CREATE OR REPLACE FUNCTION public.is_alumni_directory_visible(
  p_alumni_id uuid,
  p_org_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.alumni al
    WHERE al.id = p_alumni_id
      AND al.organization_id = p_org_id
      AND al.deleted_at IS NULL
  )
  AND EXISTS (
    SELECT 1
    FROM public.user_organization_roles uor
    WHERE uor.organization_id = p_org_id
      AND uor.user_id = (SELECT auth.uid())
      AND uor.status = 'active'::public.membership_status
  );
$$;

-- Team org events visibility (aligned with calendar org-events filter).
CREATE OR REPLACE FUNCTION public.can_view_event(e public.events)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_role text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF cardinality(COALESCE(e.target_user_ids, ARRAY[]::uuid[])) > 0 THEN
    RETURN v_uid = ANY(e.target_user_ids);
  END IF;

  SELECT uor.role::text INTO v_role
  FROM public.user_organization_roles uor
  WHERE uor.organization_id = e.organization_id
    AND uor.user_id = v_uid
    AND uor.status = 'active'::public.membership_status
  LIMIT 1;

  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  IF v_role = 'admin' THEN
    RETURN true;
  END IF;

  IF COALESCE(e.audience, 'all')::text IN ('all', 'both') THEN
    RETURN true;
  END IF;

  IF e.audience::text = 'members' THEN
    RETURN v_role IN ('active_member', 'member');
  END IF;

  IF e.audience::text = 'alumni' THEN
    RETURN v_role = 'alumni';
  END IF;

  RETURN true;
END;
$$;

-- Trigram indexes (expressions match ranking predicates).
CREATE INDEX IF NOT EXISTS idx_members_org_search_trgm
  ON public.members USING gin (
    (COALESCE(first_name, '') || ' ' || COALESCE(last_name, '') || ' ' || COALESCE(email, '')) gin_trgm_ops
  )
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alumni_org_search_trgm
  ON public.alumni USING gin (
    (
      COALESCE(first_name, '') || ' ' || COALESCE(last_name, '') || ' ' ||
      COALESCE(current_company, '') || ' ' || COALESCE(headline, '')
    ) gin_trgm_ops
  )
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_announcements_org_title_trgm
  ON public.announcements USING gin (title gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_announcements_org_body_trgm
  ON public.announcements USING gin (body gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_discussion_threads_org_title_body_trgm
  ON public.discussion_threads USING gin (
    (COALESCE(title, '') || ' ' || COALESCE(body, '')) gin_trgm_ops
  )
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_org_title_desc_trgm
  ON public.events USING gin (
    (COALESCE(title, '') || ' ' || COALESCE(description, '')) gin_trgm_ops
  )
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_job_postings_org_title_company_trgm
  ON public.job_postings USING gin (
    (COALESCE(title, '') || ' ' || COALESCE(company, '')) gin_trgm_ops
  )
  WHERE deleted_at IS NULL;

-- Prefix-oriented btree helpers (short queries).
CREATE INDEX IF NOT EXISTS idx_members_org_created
  ON public.members (organization_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alumni_org_created
  ON public.alumni (organization_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_announcements_org_created
  ON public.announcements (organization_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_discussion_threads_org_created
  ON public.discussion_threads (organization_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_org_start
  ON public.events (organization_id, start_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_job_postings_org_created
  ON public.job_postings (organization_id, created_at DESC)
  WHERE deleted_at IS NULL AND is_active = true;

CREATE OR REPLACE FUNCTION public.search_org_content(
  p_org_id uuid,
  p_org_slug text,
  p_query text,
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  entity_type text,
  entity_id uuid,
  title text,
  snippet text,
  url_path text,
  rank real,
  metadata jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_trim text;
  v_short boolean;
  v_prefix text;
  v_sub text;
  v_lim int;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_organization_roles uor
    WHERE uor.organization_id = p_org_id
      AND uor.user_id = v_uid
      AND uor.status = 'active'::public.membership_status
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_org_id
      AND o.slug = p_org_slug
  ) THEN
    RETURN;
  END IF;

  -- Strip LIKE metacharacters so user input cannot broaden matches.
  v_trim := trim(regexp_replace(trim(p_query), E'[%_\\\\]', ' ', 'g'));
  IF v_trim = '' THEN
    RETURN;
  END IF;

  -- Queries shorter than 4 characters use substring matching only (trigram
  -- similarity is too noisy on 1-3 char tokens).
  v_short := length(v_trim) < 4;
  v_prefix := v_trim || '%';
  v_sub := '%' || v_trim || '%';
  v_lim := GREATEST(1, LEAST(COALESCE(p_limit, 20), 50));

  RETURN QUERY
  WITH
  member_rows AS (
    SELECT
      'member'::text AS entity_type,
      m.id AS entity_id,
      trim(both ' ' FROM concat_ws(' ', m.first_name, m.last_name)) AS title,
      left(regexp_replace(COALESCE(m.email, ''), '\s+', ' ', 'g'), 120) AS snippet,
      ('/' || p_org_slug || '/members/' || m.id::text) AS url_path,
      CASE
        WHEN v_short THEN 1.0::real
        ELSE GREATEST(
          public.word_similarity(
            v_trim,
            COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '') || ' ' || COALESCE(m.email, '')
          )::real,
          0.0::real
        )
      END AS rank,
      '{}'::jsonb AS metadata,
      m.created_at AS sort_at
    FROM public.members m
    WHERE m.organization_id = p_org_id
      AND m.deleted_at IS NULL
      AND public.is_member_directory_visible(m.id, p_org_id)
      AND (
        lower(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) LIKE lower(v_sub)
        OR lower(COALESCE(m.email, '')) LIKE lower(v_sub)
      )
    ORDER BY sort_at DESC
    LIMIT v_lim
  ),
  alumni_rows AS (
    SELECT
      'alumni'::text,
      al.id,
      trim(both ' ' FROM concat_ws(' ', al.first_name, al.last_name)),
      left(
        regexp_replace(
          COALESCE(al.current_company, '') || ' ' || COALESCE(al.headline, ''),
          '\s+',
          ' ',
          'g'
        ),
        120
      ),
      '/' || p_org_slug || '/alumni/' || al.id::text,
      CASE
        WHEN v_short THEN 1.0::real
        ELSE GREATEST(
          public.word_similarity(
            v_trim,
            COALESCE(al.first_name, '') || ' ' || COALESCE(al.last_name, '') || ' ' ||
            COALESCE(al.current_company, '') || ' ' || COALESCE(al.headline, '')
          )::real,
          0.0::real
        )
      END,
      '{}'::jsonb,
      al.created_at
    FROM public.alumni al
    WHERE al.organization_id = p_org_id
      AND al.deleted_at IS NULL
      AND public.is_alumni_directory_visible(al.id, p_org_id)
      AND (
        lower(COALESCE(al.first_name, '') || ' ' || COALESCE(al.last_name, '')) LIKE lower(v_sub)
        OR lower(COALESCE(al.current_company, '')) LIKE lower(v_sub)
        OR lower(COALESCE(al.headline, '')) LIKE lower(v_sub)
      )
    ORDER BY al.created_at DESC NULLS LAST
    LIMIT v_lim
  ),
  announcement_rows AS (
    SELECT
      'announcement'::text,
      a.id,
      COALESCE(a.title, ''),
      left(regexp_replace(COALESCE(a.body, ''), '\s+', ' ', 'g'), 140),
      '/' || p_org_slug || '/announcements',
      CASE
        WHEN v_short THEN
          CASE
            WHEN lower(COALESCE(a.title, '')) LIKE lower(v_prefix) THEN 1.0::real
            ELSE 0.5::real
          END
        ELSE GREATEST(
          public.word_similarity(v_trim, COALESCE(a.title, ''))::real,
          public.word_similarity(v_trim, COALESCE(a.body, ''))::real,
          0.0::real
        )
      END,
      jsonb_build_object('announcement_id', a.id),
      a.created_at
    FROM public.announcements a
    WHERE a.organization_id = p_org_id
      AND a.deleted_at IS NULL
      AND public.can_view_announcement(a)
      AND (
        lower(COALESCE(a.title, '')) LIKE lower(v_sub)
        OR lower(COALESCE(a.body, '')) LIKE lower(v_sub)
      )
    ORDER BY a.created_at DESC NULLS LAST
    LIMIT v_lim
  ),
  thread_rows AS (
    SELECT
      'discussion_thread'::text,
      t.id,
      COALESCE(t.title, 'Discussion'),
      left(regexp_replace(COALESCE(t.body, ''), '\s+', ' ', 'g'), 140),
      '/' || p_org_slug || '/messages/threads/' || t.id::text,
      CASE
        WHEN v_short THEN
          CASE WHEN lower(COALESCE(t.title, '')) LIKE lower(v_prefix) THEN 1.0::real ELSE 0.5::real END
        ELSE GREATEST(
          public.word_similarity(v_trim, COALESCE(t.title, '') || ' ' || COALESCE(t.body, ''))::real,
          0.0::real
        )
      END,
      '{}'::jsonb,
      t.created_at
    FROM public.discussion_threads t
    WHERE t.organization_id = p_org_id
      AND t.deleted_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.user_organization_roles uor
        WHERE uor.organization_id = t.organization_id
          AND uor.user_id = (SELECT auth.uid())
          AND uor.status = 'active'::public.membership_status
          AND uor.role::text = ANY (
            ARRAY['admin', 'active_member', 'alumni', 'parent', 'member']::text[]
          )
      )
      AND (
        lower(COALESCE(t.title, '')) LIKE lower(v_sub)
        OR lower(COALESCE(t.body, '')) LIKE lower(v_sub)
      )
    ORDER BY t.created_at DESC NULLS LAST
    LIMIT v_lim
  ),
  event_rows AS (
    SELECT
      'event'::text,
      e.id,
      COALESCE(e.title, 'Event'),
      left(regexp_replace(COALESCE(e.description, ''), '\s+', ' ', 'g'), 140),
      '/' || p_org_slug || '/calendar/events/' || e.id::text,
      CASE
        WHEN v_short THEN
          CASE WHEN lower(COALESCE(e.title, '')) LIKE lower(v_prefix) THEN 1.0::real ELSE 0.5::real END
        ELSE GREATEST(
          public.word_similarity(v_trim, COALESCE(e.title, '') || ' ' || COALESCE(e.description, ''))::real,
          0.0::real
        )
      END,
      '{}'::jsonb,
      e.start_date
    FROM public.events e
    WHERE e.organization_id = p_org_id
      AND e.deleted_at IS NULL
      AND public.can_view_event(e)
      AND (
        lower(COALESCE(e.title, '')) LIKE lower(v_sub)
        OR lower(COALESCE(e.description, '')) LIKE lower(v_sub)
        OR lower(COALESCE(e.location, '')) LIKE lower(v_sub)
      )
    ORDER BY e.start_date DESC NULLS LAST
    LIMIT v_lim
  ),
  job_rows AS (
    SELECT
      'job_posting'::text,
      j.id,
      COALESCE(j.title, 'Job'),
      left(regexp_replace(COALESCE(j.company, ''), '\s+', ' ', 'g'), 120),
      '/' || p_org_slug || '/jobs/' || j.id::text,
      CASE
        WHEN v_short THEN
          CASE
            WHEN lower(COALESCE(j.title, '')) LIKE lower(v_prefix)
              OR lower(COALESCE(j.company, '')) LIKE lower(v_prefix)
            THEN 1.0::real
            ELSE 0.5::real
          END
        ELSE GREATEST(
          public.word_similarity(v_trim, COALESCE(j.title, '') || ' ' || COALESCE(j.company, ''))::real,
          0.0::real
        )
      END,
      '{}'::jsonb,
      j.created_at
    FROM public.job_postings j
    WHERE j.organization_id = p_org_id
      AND j.deleted_at IS NULL
      AND j.is_active = true
      AND (j.expires_at IS NULL OR j.expires_at > now())
      AND (
        lower(COALESCE(j.title, '')) LIKE lower(v_sub)
        OR lower(COALESCE(j.company, '')) LIKE lower(v_sub)
        OR lower(COALESCE(j.description, '')) LIKE lower(v_sub)
      )
    ORDER BY j.created_at DESC NULLS LAST
    LIMIT v_lim
  ),
  combined AS (
    SELECT * FROM member_rows
    UNION ALL
    SELECT * FROM alumni_rows
    UNION ALL
    SELECT * FROM announcement_rows
    UNION ALL
    SELECT * FROM thread_rows
    UNION ALL
    SELECT * FROM event_rows
    UNION ALL
    SELECT * FROM job_rows
  )
  SELECT
    c.entity_type,
    c.entity_id,
    c.title,
    c.snippet,
    c.url_path,
    c.rank,
    c.metadata
  FROM combined c
  ORDER BY
    c.rank DESC,
    c.sort_at DESC NULLS LAST
  LIMIT v_lim;
END;
$$;

REVOKE ALL ON FUNCTION public.search_org_content(uuid, text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_org_content(uuid, text, text, int) TO authenticated;

REVOKE ALL ON FUNCTION public.is_member_directory_visible(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_member_directory_visible(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.is_alumni_directory_visible(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_alumni_directory_visible(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.can_view_event(public.events) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_event(public.events) TO authenticated;
