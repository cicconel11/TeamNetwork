/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Trust-boundary self-test. Verifies the harness measures the boundaries it
 * claims to evaluate.
 *
 * Probes:
 *   1. Broken auth dep: hard-codes admin context + ignores `authContext`
 *      overrides → revoked / wrong-org / non-admin cases must FAIL because
 *      tool calls would be captured under refusal cases.
 *   2. Broken safety dep: hard-codes `verdict: "safe"` → unsafe propagation
 *      case must FAIL because leaked draft text reaches the user.
 *
 * Both probes must surface a regression. Otherwise the harness is not
 * actually exercising the boundary.
 *
 * Usage:
 *   npm run eval:ai:self-test
 */
import { ORG_ID } from "./fixtures/supabase-stub.ts";
import { buildHarnessDeps } from "./fixtures/deps.ts";
import {
  buildChatRequest,
  loadCases,
  loadChatHandlerFactory,
  setupEvalEnv,
} from "./harness.ts";
import type { EvalCase } from "./types.ts";

const createChatPostHandler = await loadChatHandlerFactory();

async function runWithBrokenAuth(testCase: EvalCase) {
  const { deps, capture } = buildHarnessDeps({
    ...testCase.input,
    authContext: { ok: true, role: "admin" },
    llmStub: testCase.input.llmStub ?? {
      pass1ToolName: "list_members",
      pass1ArgsJson: "{\"limit\":1}",
      finalText: "ok",
    },
  });
  const POST = createChatPostHandler(deps);
  await POST(buildChatRequest(testCase.input, { orgId: ORG_ID }) as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  }).then((r) => r.text());
  return capture.toolCalls;
}

async function runWithBrokenSafety(testCase: EvalCase) {
  const { deps, capture } = buildHarnessDeps({
    ...testCase.input,
    guardrails: { ...(testCase.input.guardrails ?? {}), safety: { verdict: "safe" } },
  });
  const POST = createChatPostHandler(deps);
  const response = await POST(buildChatRequest(testCase.input, { orgId: ORG_ID }) as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const body = await response.text();
  return { body, audit: capture.auditEntry };
}

async function main() {
  setupEvalEnv();

  const cases = loadCases();
  const authCases = cases.filter((c) => c.category === "auth_refusal");
  const safetyCase = cases.find((c) => c.id === "guardrail-safety-unsafe-blocks");

  if (authCases.length === 0 || !safetyCase) {
    console.error("Self-test requires auth_refusal cases and the safety propagation case.");
    process.exit(2);
  }

  let probesFailed = 0;

  for (const testCase of authCases) {
    const toolCalls = await runWithBrokenAuth(testCase);
    if (toolCalls.length === 0) {
      console.error(
        `[SELF-TEST FAIL] ${testCase.id}: broken auth dep still produced zero tool calls — boundary not exercised`
      );
      probesFailed++;
    } else {
      console.log(
        `[SELF-TEST OK] ${testCase.id}: broken auth surfaced ${toolCalls.length} tool call(s) under refusal case`
      );
    }
  }

  const { body } = await runWithBrokenSafety(safetyCase);
  const leaked = body.includes("SECRET DRAFT CONTENT THAT MUST BE BLOCKED");
  if (!leaked) {
    console.error(
      "[SELF-TEST FAIL] guardrail-safety-unsafe-blocks: broken safety dep did not leak draft — boundary not exercised"
    );
    probesFailed++;
  } else {
    console.log(
      "[SELF-TEST OK] guardrail-safety-unsafe-blocks: broken safety leaked draft as expected"
    );
  }

  if (probesFailed > 0) {
    console.error(
      `\nTrust-boundary self-test failed: ${probesFailed} probe(s) did not surface regressions.`
    );
    process.exit(1);
  }
  console.log("\nTrust-boundary self-test passed — harness measures the claimed boundaries.");
}

await main();
