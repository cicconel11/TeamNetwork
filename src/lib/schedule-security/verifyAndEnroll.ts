import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeHost } from "./allowlist";
import { ScheduleSecurityError } from "./errors";
import { safeFetch } from "./safe-fetch";
import { normalizeUrl } from "./url";

const VERIFY_TIMEOUT_MS = 8000;
const VERIFY_MAX_BYTES = 256 * 1024;

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

  // Fast-path check for blocked/active domains (optimistic read)
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

    // If pending and belongs to different org, continue to re-verify
    // (don't short-circuit, let verification run below)
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

  // Use conditional update to prevent overwriting blocked domains (race condition protection).
  // First, try to update existing non-blocked record, then insert if it doesn't exist.
  const updatePayload = {
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

  // Attempt conditional update first (only if not blocked).
  // Guard: if nextStatus is "pending", only update if current status is also "pending"
  // to prevent downgrading an active domain to pending during a race condition.
  // If nextStatus is "active", allow updating both pending->active and active->active (refresh).
  const { data: updated, error: updateError } = await client
    .from("schedule_allowed_domains")
    .update(updatePayload)
    .eq("hostname", host)
    .neq("status", "blocked")
    .in("status", nextStatus === "pending" ? ["pending"] : ["pending", "active"])
    .select("id,status,vendor_id")
    .maybeSingle();

  if (updateError) {
    console.error("[schedule-verify] Failed to update domain:", updateError);
  }

  // If update found and updated a row, we're done
  if (updated) {
    return {
      allowStatus: updated.status === "active" ? "active" : "pending",
      vendorId: verification.vendorId,
      confidence: verification.confidence,
      evidence: verification.evidence,
    };
  }

  // No row was updated - either doesn't exist or is blocked
  // Re-check to distinguish between the two cases (handles race where domain became blocked)
  const { data: recheckDomain } = await client
    .from("schedule_allowed_domains")
    .select("id,status,vendor_id")
    .eq("hostname", host)
    .maybeSingle();

  if (recheckDomain?.status === "blocked") {
    // Domain was blocked between our initial check and now
    return { allowStatus: "blocked", vendorId: recheckDomain.vendor_id };
  }

  // Domain doesn't exist yet, insert it
  if (!recheckDomain) {
    const insertPayload = {
      hostname: host,
      ...updatePayload,
    };

    const { data: inserted, error: insertError } = await client
      .from("schedule_allowed_domains")
      .insert(insertPayload)
      .select("id,status,vendor_id")
      .maybeSingle();

    if (insertError) {
      // Handle race condition: another request may have inserted first
      if (insertError.code === "23505") {
        // Unique constraint violation - row was inserted by another request
        const { data: finalCheck } = await client
          .from("schedule_allowed_domains")
          .select("id,status,vendor_id")
          .eq("hostname", host)
          .maybeSingle();

        if (finalCheck?.status === "blocked") {
          return { allowStatus: "blocked", vendorId: finalCheck.vendor_id };
        }

        return {
          allowStatus: finalCheck?.status === "active" ? "active" : "pending",
          vendorId: verification.vendorId,
          confidence: verification.confidence,
          evidence: verification.evidence,
        };
      }

      console.error("[schedule-verify] Failed to insert domain:", insertError);
      throw new ScheduleSecurityError("fetch_failed", "Unable to enroll schedule domain.");
    }

    return {
      allowStatus: inserted?.status === "active" ? "active" : "pending",
      vendorId: verification.vendorId,
      confidence: verification.confidence,
      evidence: verification.evidence,
    };
  }

  // Domain exists with different status (shouldn't reach here, but handle gracefully)
  return {
    allowStatus: recheckDomain.status === "active" ? "active" : "pending",
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
