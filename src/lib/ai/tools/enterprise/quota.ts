/* eslint-disable @typescript-eslint/no-explicit-any */
import { buildQuotaInfo, resolveCurrentQuantity } from "@/lib/enterprise/quota-logic";
import { getFreeSubOrgCount } from "@/lib/enterprise/pricing";

type EnterpriseToolSupabase = any;

export async function getEnterpriseQuota(
  serviceSupabase: EnterpriseToolSupabase,
  enterpriseId: string,
) {
  const [
    { data: subscriptionRow, error: subscriptionError },
    { data: countsRow, error: countsError },
  ] = await Promise.all([
    serviceSupabase
      .from("enterprise_subscriptions")
      .select("billing_interval, alumni_bucket_quantity, sub_org_quantity, status")
      .eq("enterprise_id", enterpriseId)
      .maybeSingle(),
    serviceSupabase
      .from("enterprise_alumni_counts")
      .select("total_alumni_count, sub_org_count, enterprise_managed_org_count")
      .eq("enterprise_id", enterpriseId)
      .maybeSingle(),
  ]);

  if (subscriptionError) {
    return { data: null, error: subscriptionError };
  }
  if (countsError) {
    return { data: null, error: countsError };
  }

  const bucketQuantity = subscriptionRow?.alumni_bucket_quantity ?? 0;
  const alumniCount = countsRow?.total_alumni_count ?? 0;
  const subOrgCount = countsRow?.sub_org_count ?? 0;
  const enterpriseManagedOrgCount =
    countsRow?.enterprise_managed_org_count ?? 0;
  const quota = buildQuotaInfo(bucketQuantity, alumniCount, subOrgCount);
  const freeSubOrgLimit = getFreeSubOrgCount(bucketQuantity);
  const configuredSubOrgLimit = resolveCurrentQuantity(
    subscriptionRow?.sub_org_quantity ?? null,
    subOrgCount,
    freeSubOrgLimit,
  );

  return {
    data: {
      status: subscriptionRow?.status ?? null,
      billing_interval: subscriptionRow?.billing_interval ?? null,
      alumni: {
        bucket_quantity: bucketQuantity,
        used: quota.alumniCount,
        limit: quota.alumniLimit,
        remaining: quota.remaining,
      },
      sub_orgs: {
        total: subOrgCount,
        enterprise_managed_total: enterpriseManagedOrgCount,
        free_limit: freeSubOrgLimit,
        free_remaining: Math.max(freeSubOrgLimit - subOrgCount, 0),
        configured_limit: configuredSubOrgLimit,
        configured_remaining: Math.max(configuredSubOrgLimit - subOrgCount, 0),
      },
    },
    error: null,
  };
}

export async function getEnterpriseOrgCapacity(
  serviceSupabase: EnterpriseToolSupabase,
  enterpriseId: string,
) {
  const quotaResult = await getEnterpriseQuota(serviceSupabase, enterpriseId);
  if (quotaResult.error || !quotaResult.data) {
    return quotaResult;
  }

  const payload = quotaResult.data as {
    sub_orgs?: {
      total?: unknown;
      enterprise_managed_total?: unknown;
      free_limit?: unknown;
      free_remaining?: unknown;
    } | null;
  };

  return {
    data: {
      sub_orgs: {
        total:
          typeof payload.sub_orgs?.total === "number" ? payload.sub_orgs.total : 0,
        enterprise_managed_total:
          typeof payload.sub_orgs?.enterprise_managed_total === "number"
            ? payload.sub_orgs.enterprise_managed_total
            : 0,
        free_limit:
          typeof payload.sub_orgs?.free_limit === "number"
            ? payload.sub_orgs.free_limit
            : null,
        free_remaining:
          typeof payload.sub_orgs?.free_remaining === "number"
            ? payload.sub_orgs.free_remaining
            : null,
      },
    },
    error: null,
  };
}
