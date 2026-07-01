#!/usr/bin/env node
// Deterministic verdict validator for the AI-eval loop — the "validator that makes
// the loop *validated*, not just answerable". It is intentionally NOT an LLM: a PASS
// is only real if it carries machine-checkable evidence that the golden runner
// actually ran to a clean summary this turn. No evidence → the PASS is VOID, no
// matter how persuasive the judge's prose.
//
// This closes the gap the eval-of-eval surfaced: a judge can REJECT (or PASS) for the
// wrong reason — e.g. it never found the runner — and a gate that trusts the agent's
// word can't tell. This script trusts only the pasted runner output.
//
// Contract (stdin = a JSON object the judge emits):
//   {
//     "verdict":     "PASS" | "REJECT",   // what the judge claims
//     "baseline":    20,                   // P from ai-eval-baseline.md
//     "total_rows":  20,                   // T from ai-eval-baseline.md
//     "runner_output": "...",              // RAW stdout+stderr of the golden runner, ANSI ok
//     "diff_applied":  true,               // did the candidate diff apply to the worktree?
//     "regressions":  "none" | "row, row"  // rows that passed on main and now fail
//   }
//
// Exit 0  → verdict is VALIDATED (evidence consistent; final verdict printed).
// Exit 1  → verdict is VOID (PASS without evidence, or inconsistent) → treat as REJECT.
// Exit 2  → bad input (could not parse the evidence object).
//
// The script never trusts a claimed score; it recomputes pass/total from runner_output.

import { readFileSync } from "node:fs";

/** Strip ANSI escape codes so the glyph/colour formatting can't hide the numbers. */
function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Pull `tests N`, `pass N`, `fail N` out of node:test summary output.
 * Lines look like `ℹ tests 20` / `ℹ pass 20` / `ℹ fail 0` (leading glyph + spaces vary).
 * Anchored on the keyword + integer, glyph-agnostic. Returns null if any are missing.
 */
function parseRunnerSummary(raw) {
  const clean = stripAnsi(raw);
  const grab = (key) => {
    // word-boundary on the key, then the first integer after it on that line
    const m = clean.match(new RegExp(`(?:^|\\s)${key}\\s+(\\d+)\\b`, "m"));
    return m ? Number(m[1]) : null;
  };
  const tests = grab("tests");
  const pass = grab("pass");
  const fail = grab("fail");
  if (tests === null || pass === null || fail === null) return null;
  return { tests, pass, fail };
}

function fail(reason, finalVerdict) {
  // A void/failed validation always degrades to REJECT — never a silent PASS.
  process.stdout.write(
    JSON.stringify({ validated: false, final_verdict: finalVerdict ?? "REJECT", reason }) + "\n",
  );
  process.exit(1);
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch (err) {
    process.stderr.write(`validate-verdict: could not parse evidence JSON: ${err.message}\n`);
    process.exit(2);
  }

  const { verdict, baseline, total_rows, runner_output, diff_applied, regressions } = input;

  // ---- structural gates (bad input is a hard error, not a verdict) --------
  if (verdict !== "PASS" && verdict !== "REJECT") {
    process.stderr.write(`validate-verdict: 'verdict' must be PASS or REJECT, got ${JSON.stringify(verdict)}\n`);
    process.exit(2);
  }
  if (!Number.isInteger(baseline) || !Number.isInteger(total_rows)) {
    process.stderr.write("validate-verdict: 'baseline' and 'total_rows' must be integers\n");
    process.exit(2);
  }

  // ---- a REJECT needs no evidence: rejecting is always safe ---------------
  if (verdict === "REJECT") {
    process.stdout.write(
      JSON.stringify({ validated: true, final_verdict: "REJECT", reason: "reject requires no evidence" }) + "\n",
    );
    process.exit(0);
  }

  // ---- from here, verdict === "PASS": evidence is MANDATORY ---------------
  if (diff_applied !== true) {
    return fail("PASS claimed but diff_applied is not true — the judge may have graded main, not the candidate");
  }
  if (typeof runner_output !== "string" || runner_output.trim() === "") {
    return fail("PASS claimed with no runner_output — a PASS asserts the runner ran this turn; void");
  }

  const summary = parseRunnerSummary(runner_output);
  if (summary === null) {
    return fail("PASS claimed but runner_output has no parseable 'tests/pass/fail' summary — runner did not reach a clean summary; void");
  }

  // recomputed total must equal the declared row count — no silently-skipped rows
  if (summary.tests !== total_rows) {
    return fail(`PASS claimed but runner graded ${summary.tests} rows, not ${total_rows} — partial run; void`);
  }
  // internal consistency: pass + fail must account for every row
  if (summary.pass + summary.fail !== summary.tests) {
    return fail(`PASS claimed but pass(${summary.pass}) + fail(${summary.fail}) != tests(${summary.tests}) — inconsistent summary; void`);
  }
  // a PASS that still has failing rows is a contradiction
  if (summary.fail > 0) {
    return fail(`PASS claimed but runner reports ${summary.fail} failing row(s) — contradiction; void`);
  }
  // the gate itself: PASS must BEAT baseline. A tie (recomputed == baseline) is REJECT.
  if (summary.pass <= baseline) {
    return fail(
      `PASS claimed but recomputed ${summary.pass}/${summary.tests} does not beat baseline ${baseline}/${total_rows} — tie or regression is not a PASS`,
      "REJECT",
    );
  }
  // any named regression voids a PASS regardless of total
  if (typeof regressions === "string" && regressions.trim() !== "" && regressions.trim() !== "none") {
    return fail(`PASS claimed but regressions reported (${regressions}) — a regression voids a PASS`);
  }

  // evidence is present, consistent, beats baseline, no regressions → real PASS
  process.stdout.write(
    JSON.stringify({
      validated: true,
      final_verdict: "PASS",
      recomputed: `${summary.pass} / ${summary.tests}`,
      reason: `beats baseline ${baseline}/${total_rows} with no regressions and a clean runner summary`,
    }) + "\n",
  );
  process.exit(0);
}

main();
