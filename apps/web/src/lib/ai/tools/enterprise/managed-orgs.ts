/* eslint-disable @typescript-eslint/no-explicit-any */
type EnterpriseToolSupabase = any;

export async function listManagedOrgs(
  serviceSupabase: EnterpriseToolSupabase,
  enterpriseId: string,
) {
  const { data, error } = await serviceSupabase
    .from("organizations")
    .select("id, name, slug, enterprise_relationship_type, enterprise_adopted_at")
    .eq("enterprise_id", enterpriseId)
    .order("name", { ascending: true });

  if (error) {
    return { data: null, error };
  }

  return {
    data: {
      total: Array.isArray(data) ? data.length : 0,
      organizations: Array.isArray(data) ? data : [],
    },
    error: null,
  };
}
