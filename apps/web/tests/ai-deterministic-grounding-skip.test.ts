import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// D7: deterministic, template-rendered tool responses must NOT be re-checked by
// runGroundingCheck — the regex self-check is lossy on text the model never
// freely composed. This guards the skip wiring in the tool loop against
// regression (the integration path itself is exercised by the verifier tests).
const loopSource = await readFile(
  new URL(
    "../src/app/api/ai/[orgId]/chat/handler/stages/run-model-tools-loop.ts",
    import.meta.url
  ),
  "utf8"
);

test("deterministic responses set a render flag", () => {
  assert.match(loopSource, /renderedDeterministically\s*=\s*true/);
});

test("runGroundingCheck is gated on !renderedDeterministically", () => {
  // The grounding call must be inside an `if (!renderedDeterministically)` block.
  const guardIndex = loopSource.indexOf("if (!renderedDeterministically)");
  const callIndex = loopSource.indexOf("runGroundingCheck({");
  assert.ok(guardIndex !== -1, "expected a !renderedDeterministically guard");
  assert.ok(callIndex !== -1, "expected a runGroundingCheck call");
  assert.ok(
    guardIndex < callIndex,
    "runGroundingCheck must be guarded by !renderedDeterministically"
  );
});
