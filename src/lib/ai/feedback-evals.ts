import type { Json } from "@/types/database";

export type AiFeedbackEvalAnswerShape =
  | "tool_response"
  | "pending_action"
  | "refusal"
  | "unknown";

export interface AiFeedbackEvalSourceRow {
  feedback: {
    id: string;
    rating: string;
    comment: string | null;
    created_at: string;
  };
  thread: {
    id: string;
    org_id: string;
    user_id: string;
    surface: string | null;
  };
  userMessage: {
    id: string;
    content: string | null;
    intent: string | null;
    intent_type: string | null;
    context_surface: string | null;
    created_at: string;
  } | null;
  assistantMessage: {
    id: string;
    content: string | null;
    tool_calls: Json | null;
    created_at: string;
  };
  audit: {
    id: string;
    intent: string | null;
    intent_type: string | null;
    context_surface: string | null;
    tool_calls: Json | null;
    safety_verdict: string | null;
    rag_grounded: boolean | null;
    write_action_id: string | null;
    write_action_status: string | null;
  } | null;
}

export interface AiFeedbackEvalCandidate {
  id: string;
  source: "ai_feedback";
  status: "candidate";
  incomplete: boolean;
  prompt: string;
  orgId: string;
  threadId: string;
  role: "admin";
  surface: string;
  intent: string | null;
  intentType: string | null;
  expected: {
    toolCalls: string[];
    refusal: boolean;
    answerShape: AiFeedbackEvalAnswerShape;
    writeActionStatus: string | null;
  };
  sourceIds: {
    feedbackId: string;
    userMessageId: string | null;
    assistantMessageId: string;
    auditId: string | null;
  };
  feedback: {
    rating: "negative";
    comment: string | null;
    createdAt: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringFromRecord(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function extractToolName(value: unknown): string | null {
  if (!isRecord(value)) return null;

  const directName =
    stringFromRecord(value, "name") ??
    stringFromRecord(value, "tool") ??
    stringFromRecord(value, "tool_name");
  if (directName) return directName;

  const fn = value.function;
  if (isRecord(fn)) {
    return stringFromRecord(fn, "name");
  }

  return null;
}

export function extractToolNames(toolCalls: Json | null | undefined): string[] {
  if (!Array.isArray(toolCalls)) return [];

  return Array.from(
    new Set(
      toolCalls
        .map((call) => extractToolName(call))
        .filter((name): name is string => name != null)
    )
  );
}

function inferAnswerShape(input: {
  toolCalls: string[];
  audit: AiFeedbackEvalSourceRow["audit"];
}): AiFeedbackEvalAnswerShape {
  const { toolCalls, audit } = input;

  if (audit?.write_action_id || audit?.write_action_status) {
    return "pending_action";
  }

  if (audit?.safety_verdict === "blocked") {
    return "refusal";
  }

  if (toolCalls.length > 0) {
    return "tool_response";
  }

  return "unknown";
}

export function buildFeedbackEvalCandidate(
  row: AiFeedbackEvalSourceRow
): AiFeedbackEvalCandidate | null {
  if (row.feedback.rating !== "negative") return null;

  const prompt = row.userMessage?.content?.trim() ?? "";
  const auditToolNames = extractToolNames(row.audit?.tool_calls);
  const messageToolNames = extractToolNames(row.assistantMessage.tool_calls);
  const toolCalls = auditToolNames.length > 0 ? auditToolNames : messageToolNames;
  const answerShape = inferAnswerShape({ toolCalls, audit: row.audit });
  const incomplete = prompt.length === 0 || row.audit == null || answerShape === "unknown";

  return {
    id: `feedback-${row.feedback.id}`,
    source: "ai_feedback",
    status: "candidate",
    incomplete,
    prompt,
    orgId: row.thread.org_id,
    threadId: row.thread.id,
    role: "admin",
    surface:
      row.userMessage?.context_surface ??
      row.audit?.context_surface ??
      row.thread.surface ??
      "general",
    intent: row.userMessage?.intent ?? row.audit?.intent ?? null,
    intentType: row.userMessage?.intent_type ?? row.audit?.intent_type ?? null,
    expected: {
      toolCalls,
      refusal: answerShape === "refusal",
      answerShape,
      writeActionStatus: row.audit?.write_action_status ?? null,
    },
    sourceIds: {
      feedbackId: row.feedback.id,
      userMessageId: row.userMessage?.id ?? null,
      assistantMessageId: row.assistantMessage.id,
      auditId: row.audit?.id ?? null,
    },
    feedback: {
      rating: "negative",
      comment: row.feedback.comment,
      createdAt: row.feedback.created_at,
    },
  };
}

export function buildFeedbackEvalCandidates(
  rows: AiFeedbackEvalSourceRow[]
): AiFeedbackEvalCandidate[] {
  return rows
    .map((row) => buildFeedbackEvalCandidate(row))
    .filter((candidate): candidate is AiFeedbackEvalCandidate => candidate != null);
}
