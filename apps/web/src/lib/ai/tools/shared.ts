import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import { isStageTimeoutError } from "@/lib/ai/timeout";
import type { ScheduleImageMimeType } from "@/lib/ai/schedule-extraction";

export type ToolQueryResult =
  | { kind: "ok"; data: unknown }
  | { kind: "tool_error"; error: string };

export async function safeToolQuery(
  logContext: AiLogContext,
  fn: () => Promise<{ data: unknown; error: unknown }>
): Promise<ToolQueryResult> {
  try {
    const { data, error } = await fn();
    if (error) {
      aiLog("warn", "ai-tools", "query failed", logContext, {
        error: getSafeErrorMessage(error),
      });
      return { kind: "tool_error", error: "Query failed" };
    }
    return { kind: "ok", data: data ?? [] };
  } catch (err) {
    if (isStageTimeoutError(err)) {
      throw err;
    }
    aiLog("warn", "ai-tools", "unexpected error", logContext, {
      error: getSafeErrorMessage(err),
    });
    return { kind: "tool_error", error: "Unexpected error" };
  }
}

export type ToolCountResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

export async function safeToolCount(
  logContext: AiLogContext,
  fn: () => Promise<{ count: number | null; error: unknown }>
): Promise<ToolCountResult> {
  try {
    const { count, error } = await fn();
    if (error || count === null) {
      if (error) {
        aiLog("warn", "ai-tools", "count query failed", logContext, {
          error: getSafeErrorMessage(error),
        });
      } else {
        aiLog("warn", "ai-tools", "count query failed", logContext, {
          error: "count_unavailable",
        });
      }
      return { ok: false, error: "Query failed" };
    }
    return { ok: true, count };
  } catch (err) {
    if (isStageTimeoutError(err)) {
      throw err;
    }
    aiLog("warn", "ai-tools", "unexpected count error", logContext, {
      error: getSafeErrorMessage(err),
    });
    return { ok: false, error: "Unexpected error" };
  }
}


export function getSafeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = error.message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  return "unknown_error";
}

const MAX_BODY_PREVIEW_CHARS = 500;

export function truncateBody(body: string | null | undefined): string | null {
  if (typeof body !== "string" || body.trim().length === 0) {
    return null;
  }
  return body.trim().slice(0, MAX_BODY_PREVIEW_CHARS);
}

export interface MemberToolRow {
  id: string;
  user_id: string | null;
  status: string | null;
  role: string | null;
  created_at: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
}

export interface UserNameRow {
  id: string;
  name: string | null;
}

export function buildMemberName(firstName: string, lastName: string): string {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

export function isPlaceholderMemberName(firstName: string, lastName: string): boolean {
  const normalizedFirstName = firstName.trim();
  const normalizedLastName = lastName.trim();

  return (
    (normalizedFirstName.length === 0 && normalizedLastName.length === 0) ||
    (normalizedFirstName === "Member" && normalizedLastName.length === 0)
  );
}

export function isTrustworthyHumanName(value: string | null | undefined): value is string {
  const normalizedValue = value?.trim() ?? "";
  return normalizedValue.length > 0 && normalizedValue !== "Member" && !normalizedValue.includes("@");
}

const SCHEDULE_IMAGE_MIME_TYPES = new Set<ScheduleImageMimeType>([
  "image/png",
  "image/jpeg",
  "image/jpg",
]);

/** True when the attachment is a schedule image accepted for AI extraction (PNG/JPEG). */
export function isScheduleImageAttachment(attachment?: {
  mimeType: string;
} | null): boolean {
  return Boolean(
    attachment && SCHEDULE_IMAGE_MIME_TYPES.has(attachment.mimeType as ScheduleImageMimeType)
  );
}
