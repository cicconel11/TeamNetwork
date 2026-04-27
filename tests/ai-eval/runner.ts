/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Eval harness runner. Loads cases, drives `createChatPostHandler` per case,
 * captures tool calls + SSE events + audit row, runs scorers per category.
 *
 * Usage:
 *   npm run eval:ai
 *   EVAL_CATEGORY=tool_use npm run eval:ai
 */
import { ORG_ID } from "./fixtures/supabase-stub.ts";
import { buildHarnessDeps } from "./fixtures/deps.ts";
import {
  buildChatRequest,
  loadCases,
  loadChatHandlerFactory,
  setupEvalEnv,
} from "./harness.ts";
import type {
  EvalCase,
  EvalCaseResult,
  EvalCategory,
  EvalReport,
  EvalSeverity,
} from "./types.ts";
import { scoreToolUse } from "./scorers/tool-use.ts";
import { scoreOrgScopeLeak } from "./scorers/org-scope-leak.ts";
import { scoreRefusal } from "./scorers/refusal.ts";
import { scoreGuardrailPropagation } from "./scorers/guardrail-propagation.ts";
import { writeReport } from "./report.ts";

type ScorerName =
  | "tool_use"
  | "refusal"
  | "org_scope_leak"
  | "guardrail_propagation"
  | "runner";

const createChatPostHandler = await loadChatHandlerFactory();

interface SseEvent {
  type: string;
  content?: string;
  status?: number;
  body?: string;
  [key: string]: unknown;
}

function parseSse(body: string): { events: SseEvent[]; finalText: string; malformed: number } {
  const events: SseEvent[] = [];
  let finalText = "";
  let malformed = 0;
  for (const block of body.split("\n\n")) {
    const trimmed = block.trim();
    if (!trimmed.startsWith("data: ")) continue;
    const json = trimmed.slice("data: ".length);
    try {
      const event: SseEvent = JSON.parse(json);
      events.push(event);
      if (event.type === "chunk" && typeof event.content === "string") {
        finalText += event.content;
      }
    } catch {
      malformed++;
    }
  }
  return { events, finalText, malformed };
}

async function runCase(testCase: EvalCase): Promise<EvalCaseResult> {
  const start = Date.now();
  const { deps, capture } = buildHarnessDeps(testCase.input);
  const POST = createChatPostHandler(deps);

  const orgId =
    testCase.input.authContext?.ok && testCase.input.authContext.orgId
      ? testCase.input.authContext.orgId
      : ORG_ID;

  const response = await POST(buildChatRequest(testCase.input) as any, {
    params: Promise.resolve({ orgId }),
  });

  const body = await response.text();
  const isSse =
    response.headers.get("content-type")?.includes("text/event-stream") ?? false;
  const parsed = isSse
    ? parseSse(body)
    : { events: [{ type: "http_error", status: response.status, body }], finalText: body, malformed: 0 };

  const scores: Partial<Record<ScorerName, { passed: boolean; reason?: string }>> = {};
  scores.tool_use = scoreToolUse(testCase, capture.toolCalls);
  scores.org_scope_leak = scoreOrgScopeLeak(testCase, parsed.finalText);
  scores.refusal = scoreRefusal(testCase, parsed.finalText, capture.toolCalls, response.status);
  if (testCase.category === "guardrail_propagation" || testCase.expected.auditIncludes) {
    scores.guardrail_propagation = scoreGuardrailPropagation(
      testCase,
      parsed.finalText,
      capture.auditEntry
    );
  }
  if (parsed.malformed > 0) {
    scores.runner = { passed: false, reason: `${parsed.malformed} malformed SSE event(s)` };
  }

  const passed = Object.values(scores).every((s) => s!.passed);

  return {
    caseId: testCase.id,
    category: testCase.category,
    severity: testCase.severity,
    passed,
    scores: scores as Record<string, { passed: boolean; reason?: string }>,
    transcript: {
      httpStatus: response.status,
      toolCalls: capture.toolCalls,
      finalText: parsed.finalText,
      sseEvents: parsed.events,
      auditEntry: capture.auditEntry,
    },
    durationMs: Date.now() - start,
  };
}

function bucketBy<K extends string>(
  results: EvalCaseResult[],
  key: (r: EvalCaseResult) => K
): Record<K, { passed: number; failed: number }> {
  const out = {} as Record<K, { passed: number; failed: number }>;
  for (const r of results) {
    const k = key(r);
    const b = (out[k] ??= { passed: 0, failed: 0 });
    if (r.passed) b.passed++;
    else b.failed++;
  }
  return out;
}

function buildReport(results: EvalCaseResult[], startedAt: string): EvalReport {
  const totalPassed = results.filter((r) => r.passed).length;
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    totalCases: results.length,
    totalPassed,
    totalFailed: results.length - totalPassed,
    byCategory: bucketBy(results, (r) => r.category),
    bySeverity: bucketBy(results, (r) => r.severity),
    hasP0Regression: results.some((r) => !r.passed && r.severity === "p0"),
    results,
  };
}

async function main() {
  setupEvalEnv();

  const cases = loadCases();
  if (cases.length === 0) {
    console.error("No cases loaded");
    process.exit(2);
  }

  const filterCategory = process.env.EVAL_CATEGORY as EvalCategory | undefined;
  const filterSeverity = process.env.EVAL_SEVERITY as EvalSeverity | undefined;
  const filtered = cases.filter(
    (c) =>
      (!filterCategory || c.category === filterCategory) &&
      (!filterSeverity || c.severity === filterSeverity)
  );

  const startedAt = new Date().toISOString();
  const results: EvalCaseResult[] = [];
  for (const testCase of filtered) {
    try {
      const result = await runCase(testCase);
      results.push(result);
      const status = result.passed ? "PASS" : "FAIL";
      const detail = result.passed
        ? ""
        : ` :: ${Object.entries(result.scores)
            .filter(([, v]) => !v.passed)
            .map(([k, v]) => `${k}=${v.reason}`)
            .join("; ")}`;
      console.log(`[${status}] ${testCase.severity} ${testCase.category}/${testCase.id}${detail}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[ERROR] ${testCase.severity} ${testCase.category}/${testCase.id} :: ${message}`);
      results.push({
        caseId: testCase.id,
        category: testCase.category,
        severity: testCase.severity,
        passed: false,
        scores: { runner: { passed: false, reason: message } },
        transcript: {
          httpStatus: 0,
          toolCalls: [],
          finalText: "",
          sseEvents: [],
          auditEntry: null,
        },
        durationMs: 0,
      });
    }
  }

  const report = buildReport(results, startedAt);
  await writeReport(report);

  console.log(
    `\n${report.totalPassed}/${report.totalCases} passed | failed: ${report.totalFailed} | P0 regression: ${report.hasP0Regression}`
  );

  process.exit(report.hasP0Regression ? 1 : 0);
}

await main();
