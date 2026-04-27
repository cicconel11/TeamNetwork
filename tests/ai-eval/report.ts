/**
 * JSON + Markdown report writers. Reports go to
 * `tests/ai-eval/reports/<timestamp>.{json,md}` (gitignored).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EvalReport } from "./types.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPORTS_DIR = resolve(HERE, "reports");

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function buildMarkdown(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`# AI Eval Report`);
  lines.push("");
  lines.push(`- Started: ${report.startedAt}`);
  lines.push(`- Finished: ${report.finishedAt}`);
  lines.push(`- Total: ${report.totalCases}`);
  lines.push(`- Passed: ${report.totalPassed}`);
  lines.push(`- Failed: ${report.totalFailed}`);
  lines.push(`- P0 regression: ${report.hasP0Regression}`);
  lines.push("");
  lines.push(`## By category`);
  lines.push("");
  for (const [cat, stats] of Object.entries(report.byCategory)) {
    lines.push(`- ${cat}: ${stats.passed} passed / ${stats.failed} failed`);
  }
  lines.push("");
  lines.push(`## By severity`);
  lines.push("");
  for (const [sev, stats] of Object.entries(report.bySeverity)) {
    lines.push(`- ${sev}: ${stats.passed} passed / ${stats.failed} failed`);
  }
  lines.push("");
  const failed = report.results.filter((r) => !r.passed);
  if (failed.length > 0) {
    lines.push(`## Failures`);
    lines.push("");
    for (const result of failed) {
      lines.push(`### ${result.severity} ${result.category}/${result.caseId}`);
      lines.push("");
      for (const [name, score] of Object.entries(result.scores)) {
        if (!score.passed) lines.push(`- **${name}**: ${score.reason ?? "(no reason)"}`);
      }
      lines.push("");
      lines.push(`Final text: \`${result.transcript.finalText.slice(0, 200)}\``);
      lines.push("");
    }
  }
  return lines.join("\n");
}

export async function writeReport(report: EvalReport): Promise<void> {
  mkdirSync(REPORTS_DIR, { recursive: true });
  const stamp = timestamp();
  const jsonPath = resolve(REPORTS_DIR, `${stamp}.json`);
  const mdPath = resolve(REPORTS_DIR, `${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, buildMarkdown(report));
  console.log(`\nReport written to:\n  ${jsonPath}\n  ${mdPath}`);
}
