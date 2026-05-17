import { fetchWithAuth } from "@/lib/web-api";

export type ReportTargetType =
  | "chat_message"
  | "feed_post"
  | "feed_comment"
  | "user_profile";

export type ReportReason =
  | "spam"
  | "harassment"
  | "hate"
  | "sexual"
  | "violence"
  | "self_harm"
  | "illegal"
  | "impersonation"
  | "other";

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
    const json = JSON.parse(text) as {
      error?: string;
      details?: string[];
    };
    const detail = json.details && json.details.length > 0 ? ` (${json.details.join("; ")})` : "";
    return json.error ? `${json.error}${detail}` : text;
  } catch {
    return text;
  }
}

export async function reportContent(input: ReportContentInput): Promise<{ id: string }> {
  const payload = {
    organization_id: input.orgId,
    target_type: input.targetType,
    target_id: input.targetId,
    reported_user_id: input.reportedUserId ?? null,
    reason: input.reason,
    details: input.details ?? null,
  };
  const res = await fetchWithAuth("/api/moderation/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn("[moderation.reportContent] failed", { status: res.status, payload, body: text });
    throw new Error(summarizeErrorBody(text) || `Report failed (${res.status})`);
  }
  return (await res.json()) as { id: string };
}

export async function toggleBlock(blockedUserId: string): Promise<{ blocked: boolean }> {
  const payload = { blocked_user_id: blockedUserId };
  const res = await fetchWithAuth("/api/moderation/block", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn("[moderation.toggleBlock] failed", { status: res.status, payload, body: text });
    throw new Error(summarizeErrorBody(text) || `Block failed (${res.status})`);
  }
  return (await res.json()) as { blocked: boolean };
}

export async function getBlockedUsers(): Promise<string[]> {
  const res = await fetchWithAuth("/api/moderation/block", { method: "GET" });
  if (!res.ok) {
    throw new Error(`Failed to load blocks (${res.status})`);
  }
  const json = (await res.json()) as { blocked_user_ids?: string[] };
  return json.blocked_user_ids ?? [];
}
