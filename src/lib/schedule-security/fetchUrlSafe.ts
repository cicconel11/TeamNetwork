import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { checkHostStatus, touchAllowedDomain } from "./allowlist";
import { ScheduleSecurityError } from "./errors";
import { safeFetch, type SafeFetchResult } from "./safe-fetch";
import { normalizeUrl } from "./url";
import { verifyAndEnroll } from "./verifyAndEnroll";

const VERIFY_TIMEOUT_MS = 8000;
const FULL_TIMEOUT_MS = 12000;
const VERIFY_MAX_BYTES = 256 * 1024;
const FULL_MAX_BYTES = 5 * 1024 * 1024;

export type SafeFetchMode = "verify" | "full";

export type SafeFetchOptions = {
  mode?: SafeFetchMode;
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  orgId?: string;
  userId?: string;
  vendorId?: string;
  supabase?: SupabaseClient<Database>;
  allowlistMode?: "enforce" | "skip";
};

export { SafeFetchResult, ScheduleSecurityError };

export async function fetchUrlSafe(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const normalizedUrl = normalizeUrl(rawUrl);
  const mode = options.mode ?? "full";
  const timeoutMs = options.timeoutMs ?? (mode === "verify" ? VERIFY_TIMEOUT_MS : FULL_TIMEOUT_MS);
  const maxBytes = options.maxBytes ?? (mode === "verify" ? VERIFY_MAX_BYTES : FULL_MAX_BYTES);
  const allowlistMode = options.allowlistMode ?? "enforce";

  const result = await safeFetch(normalizedUrl, {
    timeoutMs,
    maxBytes,
    headers: options.headers,
    onBeforeRequest:
      allowlistMode === "enforce"
        ? async (url, host) => {
            await ensureAllowedHost({
              url,
              host,
              orgId: options.orgId,
              userId: options.userId,
              vendorId: options.vendorId,
              supabase: options.supabase,
            });
          }
        : undefined,
  });

  if (result.status >= 400) {
    throw new ScheduleSecurityError("fetch_failed", `Fetch failed (${result.status})`);
  }

  return result;
}

async function ensureAllowedHost(input: {
  url: string;
  host: string;
  orgId?: string;
  userId?: string;
  vendorId?: string;
  supabase?: SupabaseClient<Database>;
}) {
  const status = await checkHostStatus(input.host, input.vendorId, input.supabase);

  if (status.status === "active") {
    if (status.source === "domain") {
      await touchAllowedDomain(input.host, input.supabase);
    }
    return;
  }

  if (status.status === "blocked") {
    throw new ScheduleSecurityError("allowlist_blocked", "Domain is blocked.");
  }

  if (status.status === "pending") {
    throw new ScheduleSecurityError("allowlist_pending", "Domain pending admin approval.");
  }

  if (!input.orgId) {
    throw new ScheduleSecurityError("allowlist_denied", "Domain is not allowlisted.");
  }

  const enrollment = await verifyAndEnroll({
    url: input.url,
    orgId: input.orgId,
    userId: input.userId,
    supabase: input.supabase,
    vendorHint: input.vendorId,
  });

  if (enrollment.allowStatus === "active") {
    return;
  }

  if (enrollment.allowStatus === "pending") {
    throw new ScheduleSecurityError("allowlist_pending", "Domain pending admin approval.");
  }

  if (enrollment.allowStatus === "blocked") {
    throw new ScheduleSecurityError("allowlist_blocked", "Domain is blocked.");
  }

  throw new ScheduleSecurityError("allowlist_denied", "Domain is not allowlisted.");
}
