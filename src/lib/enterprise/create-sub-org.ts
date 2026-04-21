import {
  extractEnterpriseOrgLimitInfo,
  isEnterpriseOrgLimitRpcError,
  type EnterpriseOrgLimitInfo,
} from "@/lib/enterprise/org-limit-errors";

export interface CreateSubOrgParams {
  serviceSupabase: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  enterpriseId: string;
  userId: string;
  name: string;
  slug: string;
  description?: string | null;
  purpose?: string | null;
  primaryColor?: string | null;
  enterprisePrimaryColor: string | null;
}

export type CreateSubOrgResult =
  | { ok: true; org: Record<string, unknown>; orgId: string; slug: string }
  | {
      ok: false;
      error: string;
      status: number;
      kind: "slug_conflict" | "org_limit" | "create_failed";
      quota?: EnterpriseOrgLimitInfo | null;
    };

export interface SlugAvailabilityResult {
  available: boolean;
  status?: number;
  error?: string;
}

interface BatchOrgResult {
  out_slug: string;
  out_org_id: string | null;
  out_status: string;
}

export async function ensureEnterpriseSlugAvailable(
  serviceSupabase: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  slug: string
): Promise<SlugAvailabilityResult> {
  const [{ data: existingOrg, error: existingOrgError }, { data: existingEnterprise, error: existingEnterpriseError }] =
    await Promise.all([
      serviceSupabase
        .from("organizations")
        .select("id")
        .eq("slug", slug)
        .maybeSingle() as Promise<{ data: { id: string } | null; error: { message?: string } | null }>,
      serviceSupabase
        .from("enterprises")
        .select("id")
        .eq("slug", slug)
        .maybeSingle() as Promise<{ data: { id: string } | null; error: { message?: string } | null }>,
    ]);

  if (existingOrgError || existingEnterpriseError) {
    console.error("[createEnterpriseSubOrg] slug availability check failed:", {
      existingOrgError,
      existingEnterpriseError,
    });
    return {
      available: false,
      status: 500,
      error: "Failed to verify slug availability",
    };
  }

  if (existingOrg || existingEnterprise) {
    return {
      available: false,
      status: 409,
      error: "Slug is already taken",
    };
  }

  return { available: true };
}

export async function createEnterpriseSubOrg(
  params: CreateSubOrgParams
): Promise<CreateSubOrgResult> {
  const {
    serviceSupabase,
    enterpriseId,
    userId,
    name,
    slug,
    description,
    purpose,
    primaryColor,
    enterprisePrimaryColor,
  } = params;

  const resolvedColor = primaryColor ?? enterprisePrimaryColor ?? "#1e3a5f";

  const { data: rpcResult, error: rpcError } = await serviceSupabase.rpc(
    "batch_create_enterprise_orgs",
    {
      p_enterprise_id: enterpriseId,
      p_user_id: userId,
      p_orgs: [
        {
          name,
          slug,
          description: description ?? null,
          purpose: purpose ?? null,
          primary_color: resolvedColor,
        },
      ],
    }
  ) as {
    data: BatchOrgResult[] | null;
    error: { message?: string; code?: string } | null;
  };

  if (rpcError) {
    if (rpcError.code === "23505" || rpcError.message?.includes("already taken")) {
      return {
        ok: false,
        error: "Slug is already taken",
        status: 409,
        kind: "slug_conflict",
      };
    }

    if (isEnterpriseOrgLimitRpcError(rpcError)) {
      return {
        ok: false,
        error: "Organization limit reached. Upgrade your subscription to add more organizations.",
        status: 402,
        kind: "org_limit",
        quota: extractEnterpriseOrgLimitInfo(rpcError.message),
      };
    }

    console.error("[createEnterpriseSubOrg] RPC failed:", rpcError);
    return {
      ok: false,
      error: "Failed to create organization",
      status: 500,
      kind: "create_failed",
    };
  }

  const created = rpcResult?.[0];
  if (!created?.out_org_id || created.out_status !== "created") {
    if (created?.out_status === "slug_conflict") {
      return {
        ok: false,
        error: "Slug is already taken",
        status: 409,
        kind: "slug_conflict",
      };
    }

    return {
      ok: false,
      error: created?.out_status ?? "Failed to create organization",
      status: 400,
      kind: "create_failed",
    };
  }

  const { data: newOrg } = await serviceSupabase
    .from("organizations")
    .select("*")
    .eq("id", created.out_org_id)
    .single() as {
    data: Record<string, unknown> | null;
  };

  return {
    ok: true,
    org: newOrg ?? { id: created.out_org_id, slug: created.out_slug },
    orgId: created.out_org_id,
    slug: created.out_slug,
  };
}
