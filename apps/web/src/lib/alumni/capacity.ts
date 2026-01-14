import { createServiceClient } from "@/lib/supabase/service";
import { getAlumniLimitForOrg } from "@/lib/alumni-quota";
import { getLinkedInImportCapacitySnapshot } from "@/lib/alumni/linkedin-import";

interface EnterpriseAlumniCountsQuery {
  from: (table: "enterprise_alumni_counts") => {
    select: (columns: "total_alumni_count") => {
      eq: (column: "enterprise_id", value: string) => {
        maybeSingle: () => Promise<{
          data: { total_alumni_count: number } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

export async function getAlumniCapacitySnapshot(
  organizationId: string,
  existingServiceClient?: ReturnType<typeof createServiceClient>,
) {
  const serviceSupabase = existingServiceClient ?? createServiceClient();

  return getLinkedInImportCapacitySnapshot(organizationId, {
    getAlumniLimitForOrg,
    async getEnterpriseIdForOrg(orgId) {
      const { data: organization, error } = await serviceSupabase
        .from("organizations")
        .select("enterprise_id")
        .eq("id", orgId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return organization?.enterprise_id ?? null;
    },
    async countAlumniForOrg(orgId) {
      const { count, error } = await serviceSupabase
        .from("alumni")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .is("deleted_at", null);

      if (error) {
        throw error;
      }

      return count ?? 0;
    },
    async countAlumniForEnterprise(enterpriseId) {
      const enterpriseCountsSupabase = serviceSupabase as unknown as EnterpriseAlumniCountsQuery;
      const { data, error } = await enterpriseCountsSupabase
        .from("enterprise_alumni_counts")
        .select("total_alumni_count")
        .eq("enterprise_id", enterpriseId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data?.total_alumni_count ?? 0;
    },
  });
}
