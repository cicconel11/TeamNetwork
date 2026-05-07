/* eslint-disable @typescript-eslint/no-explicit-any */
type EnterpriseToolSupabase = any;

export async function getEnterpriseStats(
  serviceSupabase: EnterpriseToolSupabase,
  enterpriseId: string,
) {
  const { data, error } = await serviceSupabase.rpc("get_enterprise_alumni_stats", {
    p_enterprise_id: enterpriseId,
  });

  if (error) {
    return { data: null, error };
  }

  const payload = data && typeof data === "object" ? data : {};

  return {
    data: {
      total_count:
        typeof payload.total_count === "number" ? payload.total_count : 0,
      org_stats: Array.isArray(payload.org_stats) ? payload.org_stats : [],
      top_industries: Array.isArray(payload.top_industries)
        ? payload.top_industries
        : [],
      filter_options:
        payload.filter_options && typeof payload.filter_options === "object"
          ? payload.filter_options
          : {},
    },
    error: null,
  };
}
