import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeHost } from "./allowlist";
import { ScheduleSecurityError } from "./errors";
import { safeFetch } from "./safe-fetch";
import { normalizeUrl } from "./url";

const VERIFY_TIMEOUT_MS = 8000;
const VERIFY_MAX_BYTES = 200 * 1024;

export type VerificationResult = {
  vendorId: string;
  confidence: number;
  evidence: string[];
  headers: Record<string, string>;
};

export type EnrollmentResult = {
  allowStatus: "active" | "pending" | "blocked" | "denied";
  vendorId?: string;
  confidence?: number;
  evidence?: string[];
};

export async function verifyHost(url: string): Promise<VerificationResult> {
  const normalizedUrl = normalizeUrl(url);
  const result = await safeFetch(normalizedUrl, {
    timeoutMs: VERIFY_TIMEOUT_MS,
    maxBytes: VERIFY_MAX_BYTES,
  });

  if (result.status >= 400) {
    throw new ScheduleSecurityError("fetch_failed", `Fetch failed (${result.status})`);
  }

  return detectVendor(result, normalizedUrl);
}

export async function verifyAndEnroll(input: {
  url: string;
  orgId: string;
  userId?: string;
  supabase?: SupabaseClient<Database>;
  vendorHint?: string;
}): Promise<EnrollmentResult> {
  const normalizedUrl = normalizeUrl(input.url);
  const host = normalizeHost(new URL(normalizedUrl).hostname);
  const client = input.supabase ?? createServiceClient();

  const { data: existing, error: existingError } = await client
    .from("schedule_allowed_domains")
    .select("id,hostname,vendor_id,status")
    .eq("hostname", host)
    .maybeSingle();

  if (existingError) {
    console.error("[schedule-verify] Failed to load allowed domain:", existingError);
  }

  if (existing) {
    if (existing.status === "blocked") {
      return { allowStatus: "blocked", vendorId: existing.vendor_id };
    }

    if (existing.status === "active") {
      await client
        .from("schedule_allowed_domains")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", existing.id);
      return { allowStatus: "active", vendorId: existing.vendor_id };
    }
  }

  const verification = await verifyHost(normalizedUrl);

  const allowStatus =
    verification.confidence >= 0.95
      ? "active"
      : verification.confidence >= 0.8
      ? "pending"
      : "denied";

  if (allowStatus === "denied") {
    return {
      allowStatus,
      vendorId: verification.vendorId,
      confidence: verification.confidence,
      evidence: verification.evidence,
    };
  }

  const now = new Date().toISOString();
  const nextStatus: "active" | "pending" = allowStatus === "active" ? "active" : "pending";

  const upsertPayload = {
    hostname: host,
    vendor_id: verification.vendorId,
    status: nextStatus,
    verified_by_org_id: input.orgId,
    verified_by_user_id: input.userId ?? null,
    verified_at: nextStatus === "active" ? now : null,
    verification_method: "fingerprint",
    fingerprint: {
      evidence: verification.evidence,
      confidence: verification.confidence,
      vendorHint: input.vendorHint ?? null,
    },
    last_seen_at: now,
  };

  const { data: upserted, error: upsertError } = await client
    .from("schedule_allowed_domains")
    .upsert(upsertPayload, { onConflict: "hostname" })
    .select("id,status")
    .maybeSingle();

  if (upsertError) {
    console.error("[schedule-verify] Failed to upsert domain:", upsertError);
    throw new ScheduleSecurityError("fetch_failed", "Unable to enroll schedule domain.");
  }

  if (existing?.status === "pending" && nextStatus === "active") {
    await client
      .from("schedule_allowed_domains")
      .update({ verified_at: now, status: "active" })
      .eq("hostname", host);
  }

  return {
    allowStatus: upserted?.status === "active" ? "active" : "pending",
    vendorId: verification.vendorId,
    confidence: verification.confidence,
    evidence: verification.evidence,
  };
}

function detectVendor(result: { headers: Record<string, string>; text: string }, url: string): VerificationResult {
  const text = result.text || "";
  const lowerText = text.toLowerCase();
  const headers = result.headers || {};
  const contentType = headers["content-type"] || "";
  const host = normalizeHost(new URL(url).hostname);

  const evidence: string[] = [];

  if (contentType.includes("text/calendar") || text.trimStart().startsWith("BEGIN:VCALENDAR")) {
    evidence.push("ics_content");
    return { vendorId: "ics", confidence: 0.99, evidence, headers };
  }

  const hostVendor = inferVendorFromHost(host);
  const markerVendor = inferVendorFromMarkers(lowerText);

  if (hostVendor && markerVendor && hostVendor === markerVendor) {
    evidence.push("host_match", "html_marker");
    return { vendorId: hostVendor, confidence: 0.97, evidence, headers };
  }

  if (hostVendor) {
    evidence.push("host_match");
    return { vendorId: hostVendor, confidence: 0.92, evidence, headers };
  }

  if (markerVendor) {
    evidence.push("html_marker");
    return { vendorId: markerVendor, confidence: 0.85, evidence, headers };
  }

  return { vendorId: "unknown", confidence: 0.0, evidence: ["unknown"], headers };
}

function inferVendorFromHost(host: string) {
  if (host.endsWith("sidearmsports.com")) return "sidearmsports";
  if (host.endsWith("prestosports.com")) return "prestosports";
  if (host.endsWith("vantagesportz.com")) return "vantage";
  if (host.endsWith("sportsengine.com") || host.endsWith("sportngin.com")) return "sportsengine";
  if (host.endsWith("teamsnap.com")) return "teamsnap";
  if (host.endsWith("leagueapps.com")) return "leagueapps";
  if (host.endsWith("arbitersports.com")) return "arbiter";
  if (host.endsWith("bigteams.com")) return "bigteams";
  if (host.endsWith("rankone.com") || host.endsWith("rankonesport.com")) return "rankone";
  if (host.endsWith("rschooltoday.com") || host.endsWith("activityscheduler.com")) return "rschooltoday";
  return null;
}

function inferVendorFromMarkers(lowerText: string) {
  if (lowerText.includes("sidearmsports") || lowerText.includes("sidearm sports")) return "sidearmsports";
  if (lowerText.includes("prestosports") || lowerText.includes("presto sports")) return "prestosports";
  if (lowerText.includes("vantagesportz") || lowerText.includes("vantage")) return "vantage";
  if (lowerText.includes("sportngin") || lowerText.includes("sportsengine")) return "sportsengine";
  if (lowerText.includes("teamsnap")) return "teamsnap";
  if (lowerText.includes("leagueapps")) return "leagueapps";
  if (lowerText.includes("arbitersports")) return "arbiter";
  if (lowerText.includes("bigteams") || lowerText.includes("schedulestar")) return "bigteams";
  if (lowerText.includes("rank one") || lowerText.includes("rankone")) return "rankone";
  if (lowerText.includes("rschooltoday") || lowerText.includes("activity scheduler")) return "rschooltoday";
  return null;
}
