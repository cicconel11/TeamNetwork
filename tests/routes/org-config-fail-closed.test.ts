/**
 * Org Config Fail-Closed Tests
 *
 * Verifies that all API routes capturing org config for role-based access
 * destructure `error` from the query and return 500 on failure, rather than
 * silently falling through to feature defaults (fail-open).
 *
 * Pattern: source-code audit (reads files, asserts on code shape).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("org config queries fail closed", () => {
  const routes = [
    {
      file: "src/app/api/media/upload-intent/route.ts",
      label: "upload-intent",
      roleColumn: "roleColumn",
      hasRateLimitHeaders: true,
    },
    {
      file: "src/app/api/feed/route.ts",
      label: "feed",
      roleColumn: "feed_post_roles",
      hasRateLimitHeaders: false,
    },
    {
      file: "src/app/api/discussions/route.ts",
      label: "discussions",
      roleColumn: "discussion_post_roles",
      hasRateLimitHeaders: false,
    },
    {
      file: "src/app/api/jobs/route.ts",
      label: "jobs",
      roleColumn: "job_post_roles",
      hasRateLimitHeaders: false,
    },
  ];

  for (const route of routes) {
    describe(route.label, () => {
      it("destructures error from the org config query", () => {
        const source = readSource(route.file);
        // Must capture error from the org config query (e.g. `error: orgError` or `error: orgConfigError`)
        assert.match(
          source,
          /const\s*\{[^}]*error\s*:\s*org\w*Error[^}]*\}\s*=\s*await\s+supabase/,
          `${route.label}: org config query must destructure error (e.g. error: orgError)`,
        );
      });

      it("returns 500 when the org config query errors", () => {
        const source = readSource(route.file);
        // Must have a conditional that checks the error and returns 500
        assert.match(
          source,
          /if\s*\(\s*org\w*Error\s*\)/,
          `${route.label}: must check orgError and return 500`,
        );
        assert.ok(
          source.includes("Failed to verify permissions"),
          `${route.label}: 500 response must include "Failed to verify permissions"`,
        );
      });

      it("preserves the feature defaults fallback for null org", () => {
        const source = readSource(route.file);
        // The fallback pattern (|| defaults) must still exist — don't accidentally remove it
        assert.ok(
          source.includes("featureDefaults") || source.includes('|| ["admin'),
          `${route.label}: feature defaults fallback must still be present`,
        );
      });

      if (route.hasRateLimitHeaders) {
        it("includes rateLimit.headers in the 500 response", () => {
          const source = readSource(route.file);
          // Find the orgConfigError check block and verify it includes rateLimit.headers
          const errorCheckIdx = source.indexOf("orgConfigError");
          assert.ok(errorCheckIdx > -1, "must have orgConfigError check");
          // The 500 response near the error check should include rateLimit.headers
          const afterErrorCheck = source.slice(errorCheckIdx, errorCheckIdx + 500);
          assert.ok(
            afterErrorCheck.includes("rateLimit.headers"),
            "upload-intent: 500 response for orgConfigError must include rateLimit.headers",
          );
        });
      }
    });
  }
});
