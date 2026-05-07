import { createServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AllowStatus = "active" | "pending" | "blocked" | "denied";

export type AllowlistMatch = {
  status: AllowStatus;
  source: "rule" | "domain" | "none";
  vendorId?: string;
  domainId?: string;
  verifiedByOrgId?: string;
};

const vendorAliasMap: Record<string, string[] | null> = {
  vendora: ["vantage"],
  vendorb: ["sidearmsports", "prestosports"],
  sidearm: ["sidearmsports", "prestosports"],
  sidearestosports: ["sidearmsports"],
  sidearmsports: ["sidearmsports"],
  prestosports: ["prestosports"],
  generic_html: null,
  ics: null,
};

let allowlistOverride: string[] | null = null;

/**
 * Override the allowlist check for testing purposes.
 * Only works in test/development environments to prevent production misuse.
 */
export function setAllowlistOverride(hosts: string[] | null) {
  if (process.env.NODE_ENV === "production") {
    console.error("[schedule-allowlist] setAllowlistOverride called in production - ignored");
    return;
  }
  allowlistOverride = hosts?.map(normalizeHost) ?? null;
}

export function normalizeHost(rawHost: string) {
  return rawHost.trim().toLowerCase().replace(/\.$/, "");
}

export function matchesPattern(host: string, pattern: string) {
  const normalizedHost = normalizeHost(host);
  const normalizedPattern = normalizeHost(pattern);

  if (normalizedPattern.startsWith("*.") || normalizedPattern.startsWith(".")) {
    const suffix = normalizedPattern.replace(/^\*?\./, "");
    return normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`);
  }

  return normalizedHost === normalizedPattern;
}

export async function checkHostStatus(
  host: string,
  vendorId?: string,
  supabase?: SupabaseClient<Database>
): Promise<AllowlistMatch> {
  const normalizedHost = normalizeHost(host);

  if (allowlistOverride) {
    const matched = allowlistOverride.some((entry) => matchesPattern(normalizedHost, entry));
    return {
      status: matched ? "active" : "denied",
      source: matched ? "domain" : "none",
    };
  }

  const client = supabase ?? createServiceClient();
  const vendorIds = resolveVendorIds(vendorId);

  const rulesQuery = client
    .from("schedule_domain_rules")
    .select("pattern,vendor_id,status")
    .in("status", ["active", "blocked"]);

  const rulesResponse = vendorIds ? await rulesQuery.in("vendor_id", vendorIds) : await rulesQuery;

  if (rulesResponse.error) {
    console.error("[schedule-allowlist] Failed to load domain rules:", rulesResponse.error);
  }

  const matchedRules = (rulesResponse.data || []).filter((rule) => matchesPattern(normalizedHost, rule.pattern));
  if (matchedRules.some((rule) => rule.status === "blocked")) {
    const blockedRule = matchedRules.find((rule) => rule.status === "blocked");
    return { status: "blocked", source: "rule", vendorId: blockedRule?.vendor_id };
  }

  if (matchedRules.some((rule) => rule.status === "active")) {
    const activeRule = matchedRules.find((rule) => rule.status === "active");
    return { status: "active", source: "rule", vendorId: activeRule?.vendor_id };
  }

  let domainQuery = client
    .from("schedule_allowed_domains")
    .select("id,hostname,vendor_id,status,verified_by_org_id")
    .eq("hostname", normalizedHost);

  if (vendorIds) {
    domainQuery = domainQuery.in("vendor_id", vendorIds);
  }

  const domainResponse = await domainQuery.maybeSingle();
  if (domainResponse.error) {
    console.error("[schedule-allowlist] Failed to load allowed domain:", domainResponse.error);
    return { status: "denied", source: "none" };
  }

  const domain = domainResponse.data;
  if (!domain) {
    return { status: "denied", source: "none" };
  }

  if (domain.status === "blocked") {
    return { status: "blocked", source: "domain", domainId: domain.id, vendorId: domain.vendor_id };
  }

  if (domain.status === "pending") {
    return {
      status: "pending",
      source: "domain",
      domainId: domain.id,
      vendorId: domain.vendor_id,
      verifiedByOrgId: domain.verified_by_org_id ?? undefined,
    };
  }

  return { status: "active", source: "domain", domainId: domain.id, vendorId: domain.vendor_id };
}

export async function isHostAllowed(
  host: string,
  vendorId?: string,
  supabase?: SupabaseClient<Database>
): Promise<boolean> {
  const result = await checkHostStatus(host, vendorId, supabase);
  return result.status === "active";
}

export function resolveVendorIds(vendorId?: string) {
  if (!vendorId) return null;
  const key = vendorId.trim().toLowerCase();
  if (key in vendorAliasMap) {
    return vendorAliasMap[key];
  }
  return [key];
}

export async function touchAllowedDomain(
  host: string,
  supabase?: SupabaseClient<Database>
) {
  if (allowlistOverride) return;
  const client = supabase ?? createServiceClient();
  await client
    .from("schedule_allowed_domains")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("hostname", normalizeHost(host))
    .eq("status", "active");
}
