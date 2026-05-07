import { createClient } from "@/lib/supabase/client";

export interface AvailableOrg {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface RedeemResult {
  success: boolean;
  error?: string;
  organization_id?: string;
  slug?: string;
  name?: string;
  organization_slug?: string;
  organization_name?: string;
  role?: string;
  already_member?: boolean;
  pending_approval?: boolean;
  status?: string;
  organizations?: AvailableOrg[];
  invite_token?: string;
}

export type InviteFlow = "org" | "parent" | "enterprise";
type SupabaseBrowserClient = ReturnType<typeof createClient>;

export function normalizeRedeemResult(data: unknown): RedeemResult {
  const result = (data ?? {}) as RedeemResult;
  return {
    ...result,
    slug: result.slug ?? result.organization_slug,
    name: result.name ?? result.organization_name,
  };
}

export async function redeemInviteWithFallback(
  supabase: SupabaseBrowserClient,
  codeOrToken: string,
  preferredFlow: InviteFlow = "org",
): Promise<{ result: RedeemResult | null; rpcError: string | null }> {
  const trimmedCode = codeOrToken.trim();
  const flows: InviteFlow[] = preferredFlow === "enterprise"
    ? ["enterprise", "org", "parent"]
    : ["org", "parent", "enterprise"];

  let lastResult: RedeemResult | null = null;
  let lastRpcError: string | null = null;

  for (const flow of flows) {
    if (flow === "enterprise") {
      const { data, error } = await supabase.rpc("redeem_enterprise_invite", {
        p_code_or_token: trimmedCode,
      });

      if (error) {
        lastRpcError = error.message;
        continue;
      }

      const normalized = normalizeRedeemResult(data);
      lastResult = normalized;
      if (normalized.success) {
        return { result: normalized, rpcError: null };
      }
      continue;
    }

    if (flow === "parent") {
      const { data, error } = await supabase.rpc("redeem_parent_invite", {
        p_code: trimmedCode,
      });

      if (error) {
        lastRpcError = error.message;
        continue;
      }

      const normalized = normalizeRedeemResult(data);
      lastResult = normalized;
      if (normalized.success) {
        return { result: normalized, rpcError: null };
      }
      continue;
    }

    const { data, error } = await supabase.rpc("redeem_org_invite", {
      p_code: trimmedCode,
    });

    if (error) {
      lastRpcError = error.message;
      continue;
    }

    const normalized = normalizeRedeemResult(data);
    lastResult = normalized;
    if (normalized.success) {
      return { result: normalized, rpcError: null };
    }
  }

  if (lastResult) {
    return { result: lastResult, rpcError: null };
  }

  return { result: null, rpcError: lastRpcError || "Invalid invite code. Please check the code and try again." };
}
