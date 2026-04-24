import type { ToolName } from "@/lib/ai/tools/definitions";
import type { verifyToolBackedResponse } from "@/lib/ai/tool-grounding";

export const CONNECTION_PASS1_DISAMBIGUATION_INSTRUCTION = [
  "CONNECTION TOOL ROUTING:",
  "- If the latest assistant message listed ambiguous suggest_connections options with [ref: person_type:person_id] tags and the user replies with a choice by number, position, name, or subtitle, call suggest_connections again.",
  "- In that follow-up call, use the matching person_type and person_id from the prior assistant message's [ref: person_type:person_id] tag.",
  "- Do not send person_query for that follow-up disambiguation call.",
].join("\n");

export const MENTOR_PASS2_TEMPLATE = [
  "MENTOR ANSWER CONTRACT:",
  "- If suggest_mentors returned state=resolved, respond using this exact shape:",
  "  Top mentors for [mentee name]",
  "  1. [Mentor Name] — [subtitle if present]",
  "     Why: [signal label]: [value], [signal label]: [value]",
  "- Use at most 5 suggestions.",
  "- Use only the returned mentee, suggestions, reasons, and labels.",
  "- Do not mention scores, UUIDs, or internal tool details.",
  "- Do not add a concluding summary sentence.",
  "- If state=ambiguous, ask the user which returned option they mean.",
  "- If state=not_found, say you couldn't find that person in the organization.",
  "- If state=no_suggestions, say you found the person but there are no eligible mentors matching their preferences.",
  "- If state=unauthorized, say mentor suggestions are currently available to admins only.",
].join("\n");

export const TOOL_GROUNDING_FALLBACK =
  "I couldn’t verify that answer against your organization’s data, so I’m not returning it. Please try rephrasing or ask a narrower question.";
export const EMPTY_ASSISTANT_RESPONSE_FALLBACK =
  "I didn’t get a usable response for that question. Please try again.";
export const MEMBER_TOOL_GROUNDING_FALLBACK =
  "I can list specific members from the current roster, but I couldn’t verify that summary from this tool. Try asking for a smaller list, recent members, or specific people.";
export const MEMBER_LIST_PASS2_INSTRUCTION = [
  "When using list_members results:",
  "- Only mention members explicitly present in the returned rows.",
  "- Do not infer org-wide totals, grouped counts, or role summaries.",
  "- If the user asked for more than the tool returned, say you are showing the first returned members.",
  "- Prefer simple row-backed bullets: name, optional role, optional email, optional added date.",
  "- You may render a presentation-only role suffix like `Name (Parent)` only when that role exists in the returned row.",
  "- If a row has no trustworthy human name, describe it as an email-only member/admin account instead of inventing a person name.",
].join("\n");
export const ACTIVE_DRAFT_CONTINUATION_INSTRUCTION = [
  "ACTIVE DRAFT CONTINUATION:",
  "- A matching assistant draft may already be in progress for this thread.",
  "- When a matching prepare tool is attached, treat the user's latest message as a continuation of that draft unless they clearly changed topics.",
  "- Call the attached prepare tool with the updated draft details instead of replying with read-only prose.",
  "- Do not say you lack the ability to create announcements, jobs, chat messages, group messages, discussion replies, discussion threads, or events when the matching prepare tool is attached.",
].join("\n");

export class ToolGroundingVerificationError extends Error {
  constructor(
    readonly failures: ReturnType<typeof verifyToolBackedResponse>["failures"]
  ) {
    super("tool_grounding_failed");
  }
}

export function buildSseResponse(
  stream: ReadableStream<Uint8Array>,
  headers: HeadersInit,
  threadId: string,
) {
  return new Response(stream, {
    headers: {
      ...headers,
      "x-ai-thread-id": threadId,
    },
  });
}

export function getGroundingFallbackForTools(toolNames: ToolName[]): string {
  if (toolNames.length > 0 && toolNames.every((toolName) => toolName === "list_members")) {
    return MEMBER_TOOL_GROUNDING_FALLBACK;
  }

  return TOOL_GROUNDING_FALLBACK;
}
