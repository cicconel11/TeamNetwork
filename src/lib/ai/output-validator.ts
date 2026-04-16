import {
  verifyToolBackedResponse,
  type SuccessfulToolSummary,
} from "@/lib/ai/tool-grounding";

export interface OutputValidationResult {
  valid: boolean;
  failures: string[];
  severity: "none" | "warning" | "error";
}

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  backoffMs: [500, 1000, 2000],
};

// PII patterns - SSN, credit cards
const PII_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/, label: "SSN" },
  { pattern: /\b\d{16}\b/, label: "credit_card_no_spaces" },
  { pattern: /\b(?:\d{4}[- ]){3}\d{4}\b/, label: "credit_card_with_delimiters" },
];

/**
 * Check output content for potential PII patterns.
 * Returns list of failure reasons if PII detected.
 */
export function checkOutputSafety(content: string): string[] {
  const failures: string[] = [];

  for (const { pattern, label } of PII_PATTERNS) {
    if (pattern.test(content)) {
      failures.push(`Output contains potential PII pattern: ${label}`);
    }
  }

  return failures;
}

/**
 * Main validation function composing tool grounding + safety checks.
 */
export function validateOutput(input: {
  content: string;
  toolResults: SuccessfulToolSummary[];
}): OutputValidationResult {
  const failures: string[] = [];

  // 1. Tool grounding (existing)
  const grounding = verifyToolBackedResponse(input);
  failures.push(...grounding.failures);

  // 2. Safety checks (new)
  failures.push(...checkOutputSafety(input.content));

  // Determine severity: PII = error, other failures = warning
  const hasPII = failures.some((f) => f.includes("PII"));

  return {
    valid: failures.length === 0,
    failures,
    severity: failures.length === 0 ? "none" : hasPII ? "error" : "warning",
  };
}

/**
 * Retry helper with exponential backoff.
 * Calls fn, validates result, retries on error severity until max retries or success.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  validate: (result: T) => OutputValidationResult,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY
): Promise<{ result: T; validation: OutputValidationResult; attempts: number }> {
  let lastResult!: T;
  let lastValidation!: OutputValidationResult;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    if (attempt > 0) {
      const delayMs = policy.backoffMs[attempt - 1] ?? 2000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    lastResult = await fn();
    lastValidation = validate(lastResult);

    // Stop if valid or only warning severity
    if (lastValidation.valid || lastValidation.severity !== "error") {
      return { result: lastResult, validation: lastValidation, attempts: attempt + 1 };
    }
  }

  return {
    result: lastResult,
    validation: lastValidation,
    attempts: policy.maxRetries + 1,
  };
}
