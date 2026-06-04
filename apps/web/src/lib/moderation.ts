/**
 * Client-side helpers for the moderation endpoints (report content, block/unblock
 * a user, list blocks). Web client components authenticate via the Supabase
 * session cookie, so same-origin `fetch` carries auth automatically — no token
 * wrapper is needed (unlike the mobile counterpart in
 * apps/mobile/src/lib/moderation.ts).
 */

import type {
  ReportReason,
  ReportTargetType,
} from "@/lib/schemas/moderation";

export type { ReportReason, ReportTargetType };

export interface ReportContentInput {
  orgId: string;
  targetType: ReportTargetType;
  targetId: string;
  reportedUserId?: string | null;
  reason: ReportReason;
  details?: string | null;
}

function summarizeErrorBody(text: string): string {
  if (!text) return "";
  try {
    const json = JSON.parse(text) as { error?: string; details?: string[] };
    const detail =
      json.details && json.details.length > 0
        ? ` (${json.details.join("; ")})`
        : "";
    return json.error ? `${json.error}${detail}` : text;
  } catch {
    return text;
  }
}

export async function reportContent(
  input: ReportContentInput,
): Promise<{ id: string }> {
  const res = await fetch("/api/moderation/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      organization_id: input.orgId,
      target_type: input.targetType,
      target_id: input.targetId,
      reported_user_id: input.reportedUserId ?? null,
      reason: input.reason,
      details: input.details ?? null,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(summarizeErrorBody(text) || `Report failed (${res.status})`);
  }
  return (await res.json()) as { id: string };
}

export async function toggleBlock(
  blockedUserId: string,
): Promise<{ blocked: boolean }> {
  const res = await fetch("/api/moderation/block", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocked_user_id: blockedUserId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(summarizeErrorBody(text) || `Block failed (${res.status})`);
  }
  return (await res.json()) as { blocked: boolean };
}

export async function getBlockedUserIds(): Promise<string[]> {
  const res = await fetch("/api/moderation/block", { method: "GET" });
  if (!res.ok) {
    throw new Error(`Failed to load blocks (${res.status})`);
  }
  const json = (await res.json()) as { blocked_user_ids?: string[] };
  return json.blocked_user_ids ?? [];
}
