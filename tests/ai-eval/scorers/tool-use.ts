/**
 * Pass-1 must select expected tool (or none) and pass args subset-matching
 * expected.toolArgs. Args parsed through tool's Zod schema upstream so
 * key-by-key deep equality is sufficient.
 */
import { isDeepStrictEqual } from "node:util";
import type { EvalCase } from "../types.ts";
import type { CapturedToolCall } from "../fixtures/deps.ts";

export interface ScoreResult {
  passed: boolean;
  reason?: string;
}

export function scoreToolUse(
  testCase: EvalCase,
  toolCalls: CapturedToolCall[]
): ScoreResult {
  const { expected } = testCase;

  if (expected.noToolCall || expected.toolName === null) {
    if (toolCalls.length === 0) return { passed: true };
    return {
      passed: false,
      reason: `expected no tool call, got ${toolCalls.map((c) => c.name).join(", ")}`,
    };
  }

  if (!expected.toolName) return { passed: true };

  const first = toolCalls[0];
  if (!first) {
    return { passed: false, reason: `expected tool ${expected.toolName}, no tool call captured` };
  }
  if (first.name !== expected.toolName) {
    return {
      passed: false,
      reason: `expected tool ${expected.toolName}, got ${first.name}`,
    };
  }

  if (expected.toolArgs) {
    for (const [key, value] of Object.entries(expected.toolArgs)) {
      const actual = first.args?.[key];
      if (!isDeepStrictEqual(actual, value)) {
        return {
          passed: false,
          reason: `arg ${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`,
        };
      }
    }
  }

  return { passed: true };
}
