import { normalizeAiMessage } from "@/lib/ai/message-normalization";

export type AiMessageSafetyRisk = "none" | "suspicious" | "blocked";

export interface AiMessageSafetyAssessment {
  normalizedMessage: string;
  promptSafeMessage: string;
  riskLevel: AiMessageSafetyRisk;
  reasons: string[];
}

const TRANSPORT_NOISE_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

const STRONG_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  {
    reason: "instruction_override",
    pattern: /\b(?:ignore|disregard|forget|override|bypass)\b[\s\S]{0,80}\b(?:previous|prior|above|system|developer|hidden|internal)\b[\s\S]{0,40}\b(?:instructions?|prompt|message)\b/i,
  },
  {
    reason: "prompt_exfiltration",
    pattern: /\b(?:reveal|show|print|dump|display|expose|leak|tell me)\b[\s\S]{0,80}\b(?:system|developer|hidden|internal)\b[\s\S]{0,40}\b(?:prompt|instructions?|message)\b/i,
  },
  {
    reason: "trust_boundary_crossing",
    pattern: /\b(?:act as|pretend to be|you are now|from now on)\b[\s\S]{0,80}\b(?:system|developer|tool|function|admin)\b/i,
  },
  {
    reason: "tool_schema_probe",
    pattern: /\b(?:tool|function)\s+(?:schema|schemas|definition|definitions|signature|signatures)\b/i,
  },
];

const SOFT_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  {
    reason: "prompt_reference",
    pattern: /\b(?:system prompt|developer message|hidden prompt|internal instructions?)\b/i,
  },
  {
    reason: "tool_internals_reference",
    pattern: /\b(?:tool|function)\s+(?:call|calls|payload|payloads|arguments?|internals?)\b/i,
  },
  {
    reason: "policy_override_reference",
    pattern: /\b(?:override|bypass)\b[\s\S]{0,40}\b(?:safety|guardrails?|policy|policies|instructions?)\b/i,
  },
];

export const REDACTED_HISTORY_MESSAGE =
  "[Earlier user message withheld from model context because it attempted to override assistant behavior.]";

function normalizeTransportNoise(message: string): string {
  return message
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(TRANSPORT_NOISE_PATTERN, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function assessAiMessageSafety(message: string): AiMessageSafetyAssessment {
  const promptSafeMessage = normalizeTransportNoise(message);
  const normalizedMessage = normalizeAiMessage(promptSafeMessage);
  const reasons: string[] = [];

  for (const candidate of STRONG_PATTERNS) {
    if (candidate.pattern.test(promptSafeMessage)) {
      reasons.push(candidate.reason);
    }
  }

  const riskLevel: AiMessageSafetyRisk =
    reasons.length > 0
      ? "blocked"
      : SOFT_PATTERNS.some((candidate) => {
          if (!candidate.pattern.test(promptSafeMessage)) {
            return false;
          }
          reasons.push(candidate.reason);
          return true;
        })
        ? "suspicious"
        : "none";

  return {
    normalizedMessage,
    promptSafeMessage,
    riskLevel,
    reasons,
  };
}

export function sanitizeHistoryMessageForPrompt(message: string): AiMessageSafetyAssessment {
  const assessment = assessAiMessageSafety(message);
  if (assessment.riskLevel === "none") {
    return assessment;
  }

  return {
    ...assessment,
    promptSafeMessage: REDACTED_HISTORY_MESSAGE,
  };
}
