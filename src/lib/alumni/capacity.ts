import { createServiceClient } from "@/lib/supabase/service";
import { getAlumniLimitForOrg, shouldUseEnterpriseAlumniQuota } from "@/lib/alumni-quota";
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
      const [{ data: organization, error: orgError }, { data: subscription, error: subError }] = await Promise.all([
        serviceSupabase
          .from("organizations")
          .select("enterprise_id")
          .eq("id", orgId)
          .maybeSingle(),
        serviceSupabase
          .from("organization_subscriptions")
          .select("status")
          .eq("organization_id", orgId)
          .maybeSingle(),
      ]);

      if (orgError) {
        throw orgError;
      }

      if (subError) {
        throw subError;
      }

      return shouldUseEnterpriseAlumniQuota(
        organization?.enterprise_id ?? null,
        subscription?.status ?? null,
      )
        ? (organization?.enterprise_id ?? null)
        : null;
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
