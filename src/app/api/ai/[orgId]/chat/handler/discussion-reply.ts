/* eslint-disable @typescript-eslint/no-explicit-any */
import { getNonEmptyString } from "./formatters/index";

export interface PendingActionToolPayload {
  pending_action?: {
    id?: unknown;
    action_type?: unknown;
    payload?: unknown;
    expires_at?: unknown;
    summary?: {
      title?: unknown;
      description?: unknown;
    } | null;
    revise_count?: unknown;
    previous_payload?: unknown;
  } | null;
  state?: unknown;
  missing_fields?: unknown;
  draft?: unknown;
  message?: unknown;
  source_warning?: unknown;
  clarification_kind?: unknown;
  candidate_recipients?: unknown;
  requested_recipient?: unknown;
  unavailable_reason?: unknown;
  candidate_groups?: unknown;
  requested_group?: unknown;
  candidate_thread_titles?: unknown;
  requested_thread_title?: unknown;
}

export type DiscussionReplyTargetResolution =
  | {
      kind: "resolved";
      discussionThreadId: string;
      threadTitle: string | null;
    }
  | { kind: "thread_title_required" }
  | { kind: "ambiguous"; requestedThreadTitle: string; candidateThreadTitles: string[] }
  | { kind: "not_found"; requestedThreadTitle: string }
  | { kind: "lookup_error" };

export function isDiscussionThreadDemonstrative(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  return /\b(?:this thread|that thread|the thread|this discussion|that discussion|current thread|the current thread|here)\b/i.test(
    value.trim()
  );
}

export function isChatRecipientDemonstrative(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  return /\b(?:this person|that person|this member|that member|him|her|them|here)\b/i.test(
    value.trim()
  );
}

export function normalizeDiscussionThreadTitle(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function extractDiscussionThreadLookupRows(data: unknown): Array<{ id: string; title: string }> {
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const id = getNonEmptyString((row as { id?: unknown }).id);
      const title = getNonEmptyString((row as { title?: unknown }).title);
      if (!id || !title) {
        return null;
      }

      return { id, title };
    })
    .filter((row): row is { id: string; title: string } => row !== null);
}

export async function resolveDiscussionReplyTarget(
  supabase: {
    from(table: "discussion_threads"): {
      select(columns: string): {
        eq(column: string, value: unknown): any;
      };
    };
  },
  input: {
    organizationId: string;
    requestedThreadTitle?: string | null;
  }
): Promise<DiscussionReplyTargetResolution> {
  const requestedThreadTitle = getNonEmptyString(input.requestedThreadTitle);
  if (!requestedThreadTitle || isDiscussionThreadDemonstrative(requestedThreadTitle)) {
    return { kind: "thread_title_required" };
  }

  const normalizedTitle = normalizeDiscussionThreadTitle(requestedThreadTitle);

  const buildBaseQuery = () => {
    const baseQuery = supabase
      .from("discussion_threads")
      .select("id, title")
      .eq("organization_id", input.organizationId);
    return typeof baseQuery.is === "function" ? baseQuery.is("deleted_at", null) : baseQuery;
  };

  try {
    const exactBaseQuery = buildBaseQuery();
    const exactQuery =
      typeof exactBaseQuery.ilike === "function"
        ? exactBaseQuery.ilike("title", normalizedTitle)
        : exactBaseQuery;
    const exactOrderedQuery =
      typeof exactQuery.order === "function"
        ? exactQuery.order("title", { ascending: true })
        : exactQuery;
    const { data: exactData, error: exactError } = await exactOrderedQuery;
    if (exactError) {
      return { kind: "lookup_error" };
    }

    const exactMatches = extractDiscussionThreadLookupRows(exactData);
    if (exactMatches.length === 1) {
      return {
        kind: "resolved",
        discussionThreadId: exactMatches[0].id,
        threadTitle: exactMatches[0].title,
      };
    }

    if (exactMatches.length >= 2 && exactMatches.length <= 5) {
      return {
        kind: "ambiguous",
        requestedThreadTitle: normalizedTitle,
        candidateThreadTitles: [...new Set(exactMatches.map((row) => row.title))],
      };
    }

    if (exactMatches.length > 5) {
      return { kind: "not_found", requestedThreadTitle: normalizedTitle };
    }

    const substringBaseQuery = buildBaseQuery();
    const substringPattern = `%${normalizedTitle}%`;
    const substringQuery =
      typeof substringBaseQuery.ilike === "function"
        ? substringBaseQuery.ilike("title", substringPattern)
        : substringBaseQuery;
    const substringOrderedQuery =
      typeof substringQuery.order === "function"
        ? substringQuery.order("title", { ascending: true })
        : substringQuery;
    const { data: substringData, error: substringError } = await substringOrderedQuery;
    if (substringError) {
      return { kind: "lookup_error" };
    }

    const substringMatches = extractDiscussionThreadLookupRows(substringData);
    if (substringMatches.length === 1) {
      return {
        kind: "resolved",
        discussionThreadId: substringMatches[0].id,
        threadTitle: substringMatches[0].title,
      };
    }

    if (substringMatches.length >= 2 && substringMatches.length <= 5) {
      return {
        kind: "ambiguous",
        requestedThreadTitle: normalizedTitle,
        candidateThreadTitles: [...new Set(substringMatches.map((row) => row.title))],
      };
    }

    return { kind: "not_found", requestedThreadTitle: normalizedTitle };
  } catch {
    return { kind: "lookup_error" };
  }
}

export function buildDiscussionReplyClarificationPayload(
  draft: Record<string, unknown>,
  resolution: Exclude<DiscussionReplyTargetResolution, { kind: "resolved" }>
): PendingActionToolPayload {
  switch (resolution.kind) {
    case "thread_title_required":
      return {
        state: "missing_fields",
        draft,
        missing_fields: ["thread_title"],
        clarification_kind: "thread_title_required",
      };
    case "ambiguous":
      return {
        state: "missing_fields",
        draft,
        missing_fields: ["thread_title"],
        clarification_kind: "thread_title_ambiguous",
        requested_thread_title: resolution.requestedThreadTitle,
        candidate_thread_titles: resolution.candidateThreadTitles,
      };
    case "not_found":
      return {
        state: "missing_fields",
        draft,
        missing_fields: ["thread_title"],
        clarification_kind: "thread_title_not_found",
        requested_thread_title: resolution.requestedThreadTitle,
      };
    case "lookup_error":
      return {
        state: "missing_fields",
        draft,
        missing_fields: [],
        clarification_kind: "thread_lookup_failed",
      };
  }
}
