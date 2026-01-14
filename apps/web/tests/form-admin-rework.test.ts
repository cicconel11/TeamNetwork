import assert from "node:assert/strict";
import test, { describe, beforeEach } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { relativeTime } from "../src/lib/utils/relative-time.ts";
import { createSupabaseStub } from "./utils/supabaseStub.ts";

// ---------------------------------------------------------------------------
// 1. relativeTime utility tests
// ---------------------------------------------------------------------------
describe("relativeTime utility", () => {
  test("returns 'just now' for dates less than 60 seconds ago", () => {
    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
    assert.equal(relativeTime(thirtySecondsAgo), "just now");
  });

  test("returns 'just now' for dates 0 seconds ago", () => {
    const now = new Date();
    assert.equal(relativeTime(now), "just now");
  });

  test("returns 'Xm ago' for dates a few minutes ago", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    assert.equal(relativeTime(fiveMinutesAgo), "5m ago");
  });

  test("returns '1m ago' at exactly 60 seconds", () => {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    assert.equal(relativeTime(oneMinuteAgo), "1m ago");
  });

  test("returns 'Xh ago' for dates a few hours ago", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000);
    assert.equal(relativeTime(threeHoursAgo), "3h ago");
  });

  test("returns '1h ago' at exactly 3600 seconds", () => {
    const oneHourAgo = new Date(Date.now() - 3600 * 1000);
    assert.equal(relativeTime(oneHourAgo), "1h ago");
  });

  test("returns 'Xd ago' for dates a few days ago", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400 * 1000);
    assert.equal(relativeTime(twoDaysAgo), "2d ago");
  });

  test("returns 'Xw ago' for dates a few weeks ago", () => {
    const threeWeeksAgo = new Date(Date.now() - 3 * 604800 * 1000);
    assert.equal(relativeTime(threeWeeksAgo), "3w ago");
  });

  test("returns 'Xmo ago' for dates a few months ago", () => {
    const fourMonthsAgo = new Date(Date.now() - 4 * 2592000 * 1000);
    assert.equal(relativeTime(fourMonthsAgo), "4mo ago");
  });

  test("returns 'Xy ago' for dates over a year ago", () => {
    const twoYearsAgo = new Date(Date.now() - 2 * 31536000 * 1000);
    assert.equal(relativeTime(twoYearsAgo), "2y ago");
  });

  test("returns '1y ago' at exactly one year", () => {
    const oneYearAgo = new Date(Date.now() - 31536000 * 1000);
    assert.equal(relativeTime(oneYearAgo), "1y ago");
  });

  test("returns 'just now' for future dates", () => {
    const tenMinutesFromNow = new Date(Date.now() + 10 * 60 * 1000);
    assert.equal(relativeTime(tenMinutesFromNow), "just now");
  });

  test("accepts ISO string input", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    assert.equal(relativeTime(fiveMinutesAgo), "5m ago");
  });
});

// ---------------------------------------------------------------------------
// 2. No 'responses' references in form submission code
// ---------------------------------------------------------------------------
describe("no .responses references in form submission code", () => {
  test("src/ files do not reference .responses on form_submissions objects", () => {
    const srcDir = path.resolve(import.meta.dirname, "..", "src");
    const violations: string[] = [];

    // Excluded paths (normalized with forward slashes for comparison)
    const excludedPatterns = [
      "types/database.ts",
      "forms/[formId]/page.tsx", // form fill page uses local `responses` state
    ];

    function isExcluded(filePath: string): boolean {
      const normalized = filePath.replace(/\\/g, "/");
      return excludedPatterns.some((pattern) => normalized.includes(pattern));
    }

    function walkDir(dir: string): string[] {
      const results: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip node_modules and hidden dirs
          if (entry.name === "node_modules" || entry.name.startsWith(".")) {
            continue;
          }
          results.push(...walkDir(fullPath));
        } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          results.push(fullPath);
        }
      }
      return results;
    }

    const files = walkDir(srcDir);

    for (const filePath of files) {
      if (isExcluded(filePath)) continue;

      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Look for patterns like submission.responses, sub.responses, etc.
        // but exclude comments, imports, type definitions, and the word "responses" used standalone
        if (
          /\.responses\b/.test(line) &&
          /form_submission|submission|\.responses\s*[=:]|responses\s*\|\|/.test(line)
        ) {
          violations.push(`${filePath}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    assert.equal(
      violations.length,
      0,
      `Found .responses references on form submission objects:\n${violations.join("\n")}`,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Non-submitters filtering logic
// ---------------------------------------------------------------------------
describe("non-submitters filtering logic", () => {
  test("computes difference between all members and submitters", () => {
    const allMemberIds = ["user-1", "user-2", "user-3", "user-4", "user-5"];
    const submitterIds = new Set(["user-2", "user-4"]);

    const nonSubmitters = allMemberIds.filter((id) => !submitterIds.has(id));

    assert.deepEqual(nonSubmitters, ["user-1", "user-3", "user-5"]);
  });

  test("returns all members when no one has submitted", () => {
    const allMemberIds = ["user-1", "user-2", "user-3"];
    const submitterIds = new Set<string>();

    const nonSubmitters = allMemberIds.filter((id) => !submitterIds.has(id));

    assert.deepEqual(nonSubmitters, ["user-1", "user-2", "user-3"]);
  });

  test("returns empty array when everyone has submitted", () => {
    const allMemberIds = ["user-1", "user-2"];
    const submitterIds = new Set(["user-1", "user-2"]);

    const nonSubmitters = allMemberIds.filter((id) => !submitterIds.has(id));

    assert.deepEqual(nonSubmitters, []);
  });

  test("handles empty member list", () => {
    const allMemberIds: string[] = [];
    const submitterIds = new Set(["user-1"]);

    const nonSubmitters = allMemberIds.filter((id) => !submitterIds.has(id));

    assert.deepEqual(nonSubmitters, []);
  });

  test("ignores submitter IDs not present in member list", () => {
    const allMemberIds = ["user-1", "user-2"];
    const submitterIds = new Set(["user-2", "user-99"]);

    const nonSubmitters = allMemberIds.filter((id) => !submitterIds.has(id));

    assert.deepEqual(nonSubmitters, ["user-1"]);
  });
});

// ---------------------------------------------------------------------------
// 4. Submission data access pattern
// ---------------------------------------------------------------------------
describe("submission data access pattern", () => {
  const formId = "form-100";
  const orgId = "org-100";

  let stub: ReturnType<typeof createSupabaseStub>;

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  test("submissions are accessed via .data property, not .responses", async () => {
    const fieldData = { question_1: "Answer A", question_2: "Answer B" };

    stub.seed("form_submissions", [
      {
        id: "sub-100",
        form_id: formId,
        organization_id: orgId,
        user_id: "user-100",
        data: fieldData,
        submitted_at: new Date().toISOString(),
      },
    ]);

    const { data: submissions } = await stub
      .from("form_submissions")
      .select("*")
      .eq("form_id", formId);

    assert.ok(submissions);
    assert.equal(submissions.length, 1);

    const submission = submissions[0] as Record<string, unknown>;

    // Correct: access via .data
    assert.deepEqual(submission.data, { question_1: "Answer A", question_2: "Answer B" });

    // Incorrect: .responses should not exist
    assert.equal(submission.responses, undefined, "submissions should not have a 'responses' property");
  });

  test("inserting with 'data' column makes values retrievable", async () => {
    const responses = { color: "Red", size: "L" };

    stub.from("form_submissions").insert({
      form_id: formId,
      organization_id: orgId,
      user_id: "user-101",
      data: responses,
    });

    const { data: submissions } = await stub
      .from("form_submissions")
      .select("*")
      .eq("form_id", formId);

    assert.ok(submissions);
    assert.equal(submissions.length, 1);

    const submission = submissions[0] as Record<string, unknown>;
    assert.deepEqual(submission.data, { color: "Red", size: "L" });
    assert.equal(submission.responses, undefined);
  });

  test("multiple submissions all use .data column consistently", async () => {
    stub.seed("form_submissions", [
      {
        id: "sub-200",
        form_id: formId,
        organization_id: orgId,
        user_id: "user-200",
        data: { answer: "Yes" },
        submitted_at: new Date().toISOString(),
      },
      {
        id: "sub-201",
        form_id: formId,
        organization_id: orgId,
        user_id: "user-201",
        data: { answer: "No" },
        submitted_at: new Date().toISOString(),
      },
    ]);

    const { data: submissions } = await stub
      .from("form_submissions")
      .select("*")
      .eq("form_id", formId);

    assert.ok(submissions);
    assert.equal(submissions.length, 2);

    for (const submission of submissions) {
      const row = submission as Record<string, unknown>;
      assert.ok(row.data !== undefined, "each submission should have a 'data' property");
      assert.equal(row.responses, undefined, "no submission should have a 'responses' property");
    }
  });

  test("updated submission retains .data column access", async () => {
    stub.seed("form_submissions", [
      {
        id: "sub-300",
        form_id: formId,
        organization_id: orgId,
        user_id: "user-300",
        data: { answer: "original" },
        submitted_at: new Date().toISOString(),
      },
    ]);

    await stub
      .from("form_submissions")
      .update({ data: { answer: "updated" }, submitted_at: new Date().toISOString() })
      .eq("id", "sub-300");

    const { data: submissions } = await stub
      .from("form_submissions")
      .select("*")
      .eq("id", "sub-300");

    assert.ok(submissions);
    assert.equal(submissions.length, 1);

    const submission = submissions[0] as Record<string, unknown>;
    assert.deepEqual(submission.data, { answer: "updated" });
    assert.equal(submission.responses, undefined);
  });
});
