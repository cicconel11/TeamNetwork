-- Add birth_years to get_enterprise_alumni_stats filter_options
CREATE OR REPLACE FUNCTION public.get_enterprise_alumni_stats(p_enterprise_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH enterprise_orgs AS (
    SELECT o.id AS org_id, o.name AS org_name, o.slug AS org_slug
    FROM public.organizations o
    WHERE o.enterprise_id = p_enterprise_id
  ),
  active_alumni AS (
    SELECT
      a.organization_id,
      a.graduation_year,
      a.birth_year,
      lower(trim(a.industry))     AS industry_norm,
      lower(trim(a.current_company)) AS company_norm,
      lower(trim(a.current_city)) AS city_norm,
      lower(trim(a.position_title)) AS position_norm
    FROM public.alumni a
    INNER JOIN enterprise_orgs eo ON eo.org_id = a.organization_id
    WHERE a.deleted_at IS NULL
  ),
  total AS (
    SELECT COUNT(*)::int AS cnt FROM active_alumni
  ),
  org_counts AS (
    SELECT
      eo.org_name  AS name,
      eo.org_slug  AS slug,
      COUNT(a.organization_id)::int AS count
    FROM enterprise_orgs eo
    LEFT JOIN active_alumni a ON a.organization_id = eo.org_id
    GROUP BY eo.org_id, eo.org_name, eo.org_slug
    ORDER BY count DESC
  ),
  top_industries AS (
    SELECT
      industry_norm AS name,
      COUNT(*)::int AS count
    FROM active_alumni
    WHERE industry_norm IS NOT NULL AND industry_norm <> ''
    GROUP BY industry_norm
    ORDER BY count DESC
    LIMIT 20
  ),
  distinct_years AS (
    SELECT DISTINCT graduation_year AS yr
    FROM active_alumni
    WHERE graduation_year IS NOT NULL
    ORDER BY yr
  ),
  distinct_birth_years AS (
    SELECT DISTINCT birth_year AS yr
    FROM active_alumni
    WHERE birth_year IS NOT NULL
    ORDER BY yr
  ),
  distinct_industries AS (
    SELECT DISTINCT industry_norm AS val
    FROM active_alumni
    WHERE industry_norm IS NOT NULL AND industry_norm <> ''
    ORDER BY val
  ),
  distinct_companies AS (
    SELECT DISTINCT company_norm AS val
    FROM active_alumni
    WHERE company_norm IS NOT NULL AND company_norm <> ''
    ORDER BY val
  ),
  distinct_cities AS (
    SELECT DISTINCT city_norm AS val
    FROM active_alumni
    WHERE city_norm IS NOT NULL AND city_norm <> ''
    ORDER BY val
  ),
  distinct_positions AS (
    SELECT DISTINCT position_norm AS val
    FROM active_alumni
    WHERE position_norm IS NOT NULL AND position_norm <> ''
    ORDER BY val
  )
  SELECT jsonb_build_object(
    'total_count', (SELECT cnt FROM total),
    'org_stats',   (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                      'name',  oc.name,
                      'slug',  oc.slug,
                      'count', oc.count
                    )), '[]'::jsonb) FROM org_counts oc),
    'top_industries', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                         'name',  ti.name,
                         'count', ti.count
                       )), '[]'::jsonb) FROM top_industries ti),
    'filter_options', jsonb_build_object(
      'years',      (SELECT COALESCE(jsonb_agg(yr), '[]'::jsonb) FROM distinct_years),
      'birthYears', (SELECT COALESCE(jsonb_agg(yr), '[]'::jsonb) FROM distinct_birth_years),
      'industries', (SELECT COALESCE(jsonb_agg(val), '[]'::jsonb) FROM distinct_industries),
      'companies',  (SELECT COALESCE(jsonb_agg(val), '[]'::jsonb) FROM distinct_companies),
      'cities',     (SELECT COALESCE(jsonb_agg(val), '[]'::jsonb) FROM distinct_cities),
      'positions',  (SELECT COALESCE(jsonb_agg(val), '[]'::jsonb) FROM distinct_positions)
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

-- Maintain existing permission grants
REVOKE EXECUTE ON FUNCTION public.get_enterprise_alumni_stats(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_enterprise_alumni_stats(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_enterprise_alumni_stats(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_enterprise_alumni_stats(uuid) TO service_role;
