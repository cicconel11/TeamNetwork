import { getNonEmptyString, formatDisplayRow } from "./index";

export const CONNECTION_PASS2_TEMPLATE = [
  "CONNECTION ANSWER CONTRACT:",
  "- If suggest_connections returned state=resolved, respond using this exact shape:",
  "  Top connections for [source person name]",
  "  1. [suggestion name] - [subtitle if present]",
  "  Why: [reason], [reason], [reason]",
  "- Use at most 3 suggestions.",
  "- Use only the returned source_person, suggestions, subtitles, and normalized reason labels.",
  "- Do not mention scores, UUIDs, Falkor, SQL fallback, freshness, or internal tool details.",
  "- Do not add a concluding summary sentence.",
  "- If state=ambiguous, ask the user which returned option they mean.",
  "- If the user's next message picks one of the ambiguous options you previously listed (by name, subtitle, or position), call suggest_connections again using the person_type and person_id from the [ref: person_type:person_id] tag on the matching line, not person_query.",
  "- If state=not_found, say you couldn't find that person in the organization's member or alumni data and ask for a narrower identifier.",
  "- If state=no_suggestions, say you found the person but there is not enough strong professional overlap yet to recommend a connection.",
].join("\n");

interface SuggestConnectionDisplayReason {
  label?: unknown;
}

interface SuggestConnectionDisplayRow {
  name?: unknown;
  subtitle?: unknown;
  reasons?: unknown;
}

interface SuggestConnectionDisplayPayload {
  state?: unknown;
  source_person?: { name?: unknown } | null;
  suggestions?: unknown;
  disambiguation_options?: unknown;
}

export function hasPendingConnectionDisambiguation(
  history: Array<{ role: "user" | "assistant"; content: string }>,
): boolean {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message.role !== "assistant") {
      continue;
    }
    return (
      /which one did you mean\?/i.test(message.content) &&
      /\[ref:\s*(member|alumni):[^\]\s]+\]/i.test(message.content)
    );
  }
  return false;
}

export function looksLikeConnectionDisambiguationReply(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized || normalized.length > 120) {
    return false;
  }
  if (/\n/.test(normalized)) {
    return false;
  }
  if (
    /^(?:the\s+)?(?:first|second|third|fourth|fifth|last)\b/.test(normalized) ||
    /^(?:option\s+)?\d+\b/.test(normalized)
  ) {
    return true;
  }
  return normalized.split(/\s+/).length <= 8;
}

// Walk `successfulToolResults` and add any value found at a literal
// `phone_number` key into `owned`. Unknown-shaped free-text fields are
// deliberately ignored so a poisoned tool blob cannot widen the allowlist.
export function collectPhoneNumberFields(value: unknown, owned: Set<string>, depth = 0): void {
  if (depth > 8 || value == null) return;
  if (typeof value === "string") return;
  if (Array.isArray(value)) {
    for (const item of value) collectPhoneNumberFields(item, owned, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (key === "phone_number" && typeof val === "string" && val.trim().length > 0) {
      owned.add(val.trim().toLowerCase());
      continue;
    }
    collectPhoneNumberFields(val, owned, depth + 1);
  }
}

export function formatSuggestConnectionsResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as SuggestConnectionDisplayPayload;
  const state = getNonEmptyString(payload.state);

  if (!state) {
    return null;
  }

  if (state === "not_found") {
    return "I couldn't find that person in the organization's member or alumni data. Please share a narrower identifier like a full name or email.";
  }

  if (state === "ambiguous") {
    const options = Array.isArray(payload.disambiguation_options)
      ? payload.disambiguation_options
          .map((option) => {
            if (!option || typeof option !== "object") return null;
            const row = option as {
              name?: unknown;
              subtitle?: unknown;
              person_type?: unknown;
              person_id?: unknown;
            };
            const display = formatDisplayRow(row);
            if (!display) return null;
            const personType = getNonEmptyString(row.person_type);
            const personId = getNonEmptyString(row.person_id);
            if (personType && personId && (personType === "member" || personType === "alumni")) {
              // Machine-parseable tail: lets pass-2 prompt re-call the tool
              // with stable id on the user's next turn. User-facing prefix
              // stays identical.
              return `${display} [ref: ${personType}:${personId}]`;
            }
            return display;
          })
          .filter((option): option is string => Boolean(option))
      : [];

    if (options.length === 0) {
      return null;
    }

    return `I found multiple matches. Which one did you mean?\n${options
      .map((option) => `- ${option}`)
      .join("\n")}`;
  }

  const sourceName = getNonEmptyString(payload.source_person?.name);
  if (!sourceName) {
    return null;
  }

  if (state === "no_suggestions") {
    return `I found ${sourceName}, but there isn't enough strong professional overlap yet to recommend specific connections within the organization.`;
  }

  if (state !== "resolved" || !Array.isArray(payload.suggestions)) {
    return null;
  }

  const suggestions = payload.suggestions
    .map((suggestion) => {
      if (!suggestion || typeof suggestion !== "object") {
        return null;
      }

      const displayLine = formatDisplayRow(suggestion as { name?: unknown; subtitle?: unknown });
      if (!displayLine) {
        return null;
      }

      const reasons = Array.isArray((suggestion as SuggestConnectionDisplayRow).reasons)
        ? ((suggestion as SuggestConnectionDisplayRow).reasons as SuggestConnectionDisplayReason[])
            .map((reason) => getNonEmptyString(reason?.label))
            .filter((label): label is string => Boolean(label))
        : [];

      if (reasons.length === 0) {
        return null;
      }

      return { displayLine, reasons };
    })
    .filter(
      (
        suggestion
      ): suggestion is {
        displayLine: string;
        reasons: string[];
      } => Boolean(suggestion)
    )
    .slice(0, 3);

  if (suggestions.length === 0) {
    return null;
  }

  const lines = [`Top connections for ${sourceName}`];
  for (const [index, suggestion] of suggestions.entries()) {
    lines.push(`${index + 1}. ${suggestion.displayLine}`);
    lines.push(`Why: ${suggestion.reasons.join(", ")}`);
  }

  return lines.join("\n");
}
